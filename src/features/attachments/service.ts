import { createHash } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z, type ZodError, type ZodType } from "zod";

import {
  AuthorizationError,
  requireCustomer,
} from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import {
  attachments,
  projectMemberships,
  projects,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import type {
  AppDatabase,
  Attachment,
  Request,
  RequestEventType,
} from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";
import { DomainError } from "@/lib/domain-error";
import { requireActiveCustomerProject } from "@/features/projects/authorization";
import { canEditRequest } from "@/features/requests/policy";
import {
  presentRequest,
  type RequestDto,
} from "@/features/requests/presenter";
import {
  createRequestSchema,
  updateOwnRequestSchema,
  type CreateRequestInput,
} from "@/features/requests/schemas";

import {
  commitStagedAttachments,
  discardStagedAttachments,
  removeCommittedAttachments,
  stageAttachments,
  type CommittedAttachment,
  type StagedAttachment,
  type StorageCleanupFailure,
  type StoragePaths,
} from "./storage";
import { validateAttachmentLimits } from "./validation";

const editRequestWithAttachmentsSchema = updateOwnRequestSchema.extend({
  retainedAttachmentIds: z
    .array(z.number().int().positive())
    .max(8, "保留的截图数量无效")
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "保留的截图不能重复",
    ),
});

export type EditRequestWithAttachmentsInput = z.input<
  typeof editRequestWithAttachmentsSchema
>;

export type AttachmentDto = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  url: string;
};

export type RequestWithAttachmentsDto = RequestDto & {
  attachments: AttachmentDto[];
};

type AttachmentWriteResult = {
  request: Request;
  removed: Attachment[];
};

function validationErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    const key = typeof field === "string" ? field : "form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

function parseInput<Output>(
  schema: ZodType<Output>,
  input: unknown,
): { ok: true; data: Output } | { ok: false; result: ActionFailure } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    result: actionFailure(
      "INVALID_INPUT",
      "提交的信息无效",
      validationErrors(parsed.error),
    ),
  };
}

function errorFailure(error: unknown): ActionFailure {
  if (error instanceof DomainError) {
    return actionFailure(error.code, error.message, error.fieldErrors);
  }
  if (error instanceof AuthorizationError) {
    if (error.code === "UNAUTHENTICATED") {
      return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
    }
    if (error.code === "PASSWORD_CHANGE_REQUIRED") {
      return actionFailure("PASSWORD_CHANGE_REQUIRED", "请先修改密码");
    }
    return actionFailure("FORBIDDEN", "无权执行此操作");
  }
  return actionFailure("SYSTEM_UNAVAILABLE", "系统暂时不可用，请稍后重试");
}

function authorizeCustomer(actor: AuthenticatedUser | null | undefined): ActionFailure | null {
  try {
    requireCustomer(actor);
    return null;
  } catch (error) {
    return errorFailure(error);
  }
}

function requireLiveCustomer(
  database: AppDatabase,
  actor: AuthenticatedUser,
): AuthenticatedUser & { role: "CUSTOMER" } {
  const current = database.db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .get();
  if (!current || !current.isActive || current.role !== "CUSTOMER") {
    throw new AuthorizationError("FORBIDDEN");
  }
  if (current.mustChangePassword) {
    throw new AuthorizationError("PASSWORD_CHANGE_REQUIRED");
  }
  return { ...current, role: "CUSTOMER", mustChangePassword: false };
}

function fingerprintCreatePayload(
  input: {
    projectId: number;
    content: string;
    requestType: Request["requestType"];
    priority: Request["priority"];
  },
  staged: readonly StagedAttachment[],
): string {
  const base = {
    projectId: input.projectId,
    content: input.content,
    requestType: input.requestType,
    priority: input.priority,
  };
  const normalizedPayload =
    staged.length === 0
      ? JSON.stringify(base)
      : JSON.stringify({
          ...base,
          attachments: staged.map((attachment) => ({
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            sha256: attachment.sha256,
          })),
        });
  return createHash("sha256").update(normalizedPayload, "utf8").digest("hex");
}

function appendEvent(
  database: AppDatabase,
  requestId: number,
  actorId: number,
  eventType: RequestEventType,
  payload: Record<string, unknown> | null,
  createdAt: Date,
): void {
  database.db
    .insert(requestEvents)
    .values({
      requestId,
      actorId,
      eventType,
      visibility: "PUBLIC",
      payload,
      createdAt,
    })
    .run();
}

function listRequestAttachments(
  database: AppDatabase,
  requestId: number,
): Attachment[] {
  return database.db
    .select()
    .from(attachments)
    .where(eq(attachments.requestId, requestId))
    .orderBy(asc(attachments.id))
    .all();
}

function presentAttachment(attachment: Attachment): AttachmentDto {
  return {
    id: attachment.id,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.createdAt,
    url: `/api/attachments/${attachment.id}`,
  };
}

function presentRequestWithAttachments(
  database: AppDatabase,
  request: Request,
): RequestWithAttachmentsDto {
  return {
    ...presentRequest(request),
    attachments: listRequestAttachments(database, request.id).map(presentAttachment),
  };
}

function logCleanupFailures(
  phase: "rollback" | "discard" | "remove",
  failures: StorageCleanupFailure[],
): void {
  for (const failure of failures) {
    const errorName =
      failure.error instanceof Error ? failure.error.name : "UnknownError";
    console.error(
      JSON.stringify({
        event: "attachment_cleanup_failed",
        phase,
        storageName: failure.storageName,
        errorName,
      }),
    );
  }
}

function cleanupFailedWrite(
  staged: readonly StagedAttachment[],
  committed: readonly CommittedAttachment[],
  paths: StoragePaths,
): void {
  logCleanupFailures(
    "rollback",
    removeCommittedAttachments(committed, paths),
  );
  logCleanupFailures("discard", discardStagedAttachments(staged, paths));
}

function insertStagedRows(
  database: AppDatabase,
  requestId: number,
  actorId: number,
  committed: readonly CommittedAttachment[],
  createdAt: Date,
): Attachment[] {
  const inserted: Attachment[] = [];
  for (const attachment of committed) {
    const row = database.db
      .insert(attachments)
      .values({
        requestId,
        uploadedById: actorId,
        storageName: attachment.storageName,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sha256: attachment.sha256,
        createdAt,
      })
      .returning()
      .get();
    inserted.push(row);
    appendEvent(
      database,
      requestId,
      actorId,
      "ATTACHMENT_ADDED",
      { attachmentId: row.id },
      createdAt,
    );
  }
  return inserted;
}

export async function createRequestWithAttachments(
  database: AppDatabase,
  actor: AuthenticatedUser | null | undefined,
  input: CreateRequestInput,
  files: File[],
  paths: StoragePaths,
): Promise<ActionResult<RequestWithAttachmentsDto>> {
  const denied = authorizeCustomer(actor);
  if (denied) return denied;
  const customer = requireCustomer(actor);
  const parsed = parseInput(createRequestSchema, input);
  if (!parsed.ok) return parsed.result;

  let staged: StagedAttachment[] = [];
  try {
    staged = await stageAttachments(files, paths);
  } catch (error) {
    return errorFailure(error);
  }

  const createPayloadFingerprint = fingerprintCreatePayload(parsed.data, staged);
  let committed: CommittedAttachment[] = [];
  let request: Request;
  try {
    request = database.sqlite
      .transaction(() => {
        const currentActor = requireLiveCustomer(database, customer);
        requireActiveCustomerProject(
          database,
          currentActor,
          parsed.data.projectId,
        );

        const existing = database.db
          .select()
          .from(requests)
          .where(
            and(
              eq(requests.createdById, currentActor.id),
              eq(requests.idempotencyKey, parsed.data.idempotencyKey),
            ),
          )
          .get();
        if (existing) {
          if (
            existing.createPayloadFingerprint.length === 0 ||
            existing.createPayloadFingerprint !== createPayloadFingerprint
          ) {
            throw new DomainError("CONFLICT", "幂等键已用于其他需求内容");
          }
          return existing;
        }

        const now = new Date();
        const created = database.db
          .insert(requests)
          .values({
            projectId: parsed.data.projectId,
            createdById: currentActor.id,
            content: parsed.data.content,
            requestType: parsed.data.requestType,
            priority: parsed.data.priority,
            progressStatus: "UNSCHEDULED",
            recordStatus: "ACTIVE",
            needsCustomerReply: false,
            version: 1,
            idempotencyKey: parsed.data.idempotencyKey,
            createPayloadFingerprint,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        appendEvent(
          database,
          created.id,
          currentActor.id,
          "REQUEST_CREATED",
          null,
          now,
        );
        committed = commitStagedAttachments(staged, paths);
        insertStagedRows(database, created.id, currentActor.id, committed, now);
        return created;
      })
      .immediate();
  } catch (error) {
    cleanupFailedWrite(staged, committed, paths);
    return errorFailure(error);
  }
  logCleanupFailures("discard", discardStagedAttachments(staged, paths));
  try {
    return actionSuccess(presentRequestWithAttachments(database, request));
  } catch (error) {
    return errorFailure(error);
  }
}

function requireEditableRequest(
  database: AppDatabase,
  actor: AuthenticatedUser & { role: "CUSTOMER" },
  requestId: number,
  expectedVersion: number,
): Request {
  const request = database.db
    .select()
    .from(requests)
    .where(eq(requests.id, requestId))
    .get();
  if (!request) throw new DomainError("NOT_FOUND", "需求不存在");

  const projectAccess = database.db
    .select({ isActive: projects.isActive })
    .from(projectMemberships)
    .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
    .where(
      and(
        eq(projectMemberships.customerId, actor.id),
        eq(projectMemberships.projectId, request.projectId),
      ),
    )
    .get();
  if (!projectAccess) throw new DomainError("NOT_FOUND", "需求不存在");
  if (!projectAccess.isActive) {
    throw new DomainError("FORBIDDEN", "停用项目中的需求为只读");
  }
  if (!canEditRequest(actor, request)) {
    throw new DomainError("FORBIDDEN", "当前需求不可编辑");
  }
  if (request.version !== expectedVersion) {
    throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
  }
  return request;
}

export async function editRequestWithAttachments(
  database: AppDatabase,
  actor: AuthenticatedUser | null | undefined,
  input: EditRequestWithAttachmentsInput,
  files: File[],
  paths: StoragePaths,
): Promise<ActionResult<RequestWithAttachmentsDto>> {
  const denied = authorizeCustomer(actor);
  if (denied) return denied;
  const customer = requireCustomer(actor);
  const parsed = parseInput(editRequestWithAttachmentsSchema, input);
  if (!parsed.ok) return parsed.result;

  let staged: StagedAttachment[] = [];
  try {
    staged = await stageAttachments(files, paths);
  } catch (error) {
    return errorFailure(error);
  }

  let committed: CommittedAttachment[] = [];
  let write: AttachmentWriteResult;
  try {
    write = database.sqlite
      .transaction((): AttachmentWriteResult => {
        const currentActor = requireLiveCustomer(database, customer);
        const current = requireEditableRequest(
          database,
          currentActor,
          parsed.data.requestId,
          parsed.data.expectedVersion,
        );
        const currentAttachments = listRequestAttachments(database, current.id);
        const retainedIds = new Set(parsed.data.retainedAttachmentIds);
        if (
          parsed.data.retainedAttachmentIds.some(
            (id) => !currentAttachments.some((attachment) => attachment.id === id),
          )
        ) {
          throw new DomainError("NOT_FOUND", "截图不存在");
        }
        const retained = currentAttachments.filter((attachment) =>
          retainedIds.has(attachment.id),
        );
        const removed = currentAttachments.filter(
          (attachment) => !retainedIds.has(attachment.id),
        );
        validateAttachmentLimits(staged, retained);

        committed = commitStagedAttachments(staged, paths);
        const now = new Date();
        const updated = database.db
          .update(requests)
          .set({
            content: parsed.data.content,
            requestType: parsed.data.requestType,
            priority: parsed.data.priority,
            version: sql`${requests.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(requests.id, current.id),
              eq(requests.version, current.version),
            ),
          )
          .returning()
          .get();
        if (!updated) {
          throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
        }
        appendEvent(
          database,
          current.id,
          currentActor.id,
          "REQUEST_UPDATED",
          null,
          now,
        );

        if (removed.length > 0) {
          database.db
            .delete(attachments)
            .where(inArray(attachments.id, removed.map(({ id }) => id)))
            .run();
          for (const attachment of removed) {
            appendEvent(
              database,
              current.id,
              currentActor.id,
              "ATTACHMENT_REMOVED",
              { attachmentId: attachment.id },
              now,
            );
          }
        }
        insertStagedRows(database, current.id, currentActor.id, committed, now);
        return { request: updated, removed };
      })
      .immediate();
  } catch (error) {
    cleanupFailedWrite(staged, committed, paths);
    return errorFailure(error);
  }
  logCleanupFailures("discard", discardStagedAttachments(staged, paths));
  logCleanupFailures(
    "remove",
    removeCommittedAttachments(write.removed, paths),
  );
  try {
    return actionSuccess(
      presentRequestWithAttachments(database, write.request),
    );
  } catch (error) {
    return errorFailure(error);
  }
}
