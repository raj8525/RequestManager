import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type { ZodError } from "zod";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  clarificationMessageAttachments,
  clarificationMessages,
  projectMemberships,
  projects,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import {
  commitStagedAttachments,
  discardStagedAttachments,
  removeCommittedAttachments,
  stageAttachments,
  type CommittedAttachment,
  type StagedAttachment,
  type StoragePaths,
} from "@/features/attachments/storage";
import {
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";
import { DomainError } from "@/lib/domain-error";

import {
  reopenRequestSchema,
  type ReopenRequestInput,
} from "./schemas";

export type ReopenRequestResult = {
  id: number;
  progressStatus: "UNSCHEDULED";
  version: number;
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

function failure(error: unknown): ActionFailure {
  if (error instanceof DomainError) {
    return actionFailure(error.code, error.message, error.fieldErrors);
  }
  return actionFailure("SYSTEM_UNAVAILABLE", "系统暂时不可用，请稍后重试");
}

function liveCustomer(
  database: AppDatabase,
  actor: AuthenticatedUser,
): AuthenticatedUser {
  const row = database.db
    .select()
    .from(users)
    .where(eq(users.id, actor.id))
    .get();
  if (!row || !row.isActive || row.role !== actor.role) {
    throw new DomainError("FORBIDDEN", "无权执行此操作");
  }
  if (row.mustChangePassword) {
    throw new DomainError("PASSWORD_CHANGE_REQUIRED", "请先修改密码");
  }
  if (row.role !== "CUSTOMER") {
    throw new DomainError("FORBIDDEN", "只有客户可以重新打开需求");
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: false,
  };
}

function fingerprint(
  reason: string,
  staged: readonly StagedAttachment[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        reason,
        attachments: staged.map(
          ({ originalName, mimeType, sizeBytes, sha256 }) => ({
            originalName,
            mimeType,
            sizeBytes,
            sha256,
          }),
        ),
      }),
    )
    .digest("hex");
}

function cleanup(
  staged: readonly StagedAttachment[],
  committed: readonly CommittedAttachment[],
  paths: StoragePaths,
): void {
  removeCommittedAttachments(committed, paths);
  discardStagedAttachments(staged, paths);
}

export async function reopenRequestWithAttachments(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: ReopenRequestInput,
  files: File[],
  paths: StoragePaths,
): Promise<ActionResult<ReopenRequestResult>> {
  const parsed = reopenRequestSchema.safeParse(input);
  if (!parsed.success) {
    return actionFailure(
      "INVALID_INPUT",
      "提交的信息无效",
      validationErrors(parsed.error),
    );
  }

  let staged: StagedAttachment[] = [];
  let committed: CommittedAttachment[] = [];
  try {
    staged = await stageAttachments(files, paths);
  } catch (error) {
    return failure(error);
  }

  try {
    const result = database.sqlite
      .transaction(() => {
        const customer = liveCustomer(database, actor);
        const request = database.db
          .select()
          .from(requests)
          .where(eq(requests.id, parsed.data.requestId))
          .get();
        if (!request || request.createdById !== customer.id) {
          throw new DomainError("NOT_FOUND", "需求不存在");
        }

        const membership = database.db
          .select({ isActive: projects.isActive })
          .from(projectMemberships)
          .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
          .where(
            and(
              eq(projectMemberships.customerId, customer.id),
              eq(projectMemberships.projectId, request.projectId),
            ),
          )
          .get();
        if (!membership) throw new DomainError("NOT_FOUND", "需求不存在");
        if (!membership.isActive) {
          throw new DomainError("FORBIDDEN", "停用项目中的需求不能重新打开");
        }

        const payloadFingerprint = fingerprint(parsed.data.reason, staged);
        const existing = database.db
          .select()
          .from(clarificationMessages)
          .where(
            and(
              eq(clarificationMessages.authorId, customer.id),
              eq(
                clarificationMessages.idempotencyKey,
                parsed.data.idempotencyKey,
              ),
            ),
          )
          .get();
        if (existing) {
          if (
            existing.requestId !== request.id ||
            existing.authorRole !== "CUSTOMER" ||
            existing.messageKind !== "REOPEN_REASON" ||
            existing.payloadFingerprint !== payloadFingerprint
          ) {
            throw new DomainError("CONFLICT", "幂等键已用于其他操作");
          }
          return {
            id: request.id,
            progressStatus: "UNSCHEDULED" as const,
            version: request.version,
          };
        }

        if (request.recordStatus !== "ACTIVE") {
          throw new DomainError("STATE_CONFLICT", "暂停或归档需求不能重新打开");
        }
        if (request.progressStatus !== "COMPLETED") {
          throw new DomainError("STATE_CONFLICT", "只有已完成需求可以重新打开");
        }
        if (request.version !== parsed.data.expectedVersion) {
          throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
        }

        const now = new Date();
        const message = database.db
          .insert(clarificationMessages)
          .values({
            requestId: request.id,
            authorId: customer.id,
            authorRole: "CUSTOMER",
            messageKind: "REOPEN_REASON",
            content: parsed.data.reason,
            idempotencyKey: parsed.data.idempotencyKey,
            payloadFingerprint,
            createdAt: now,
          })
          .returning()
          .get();

        committed = commitStagedAttachments(staged, paths);
        for (const attachment of committed) {
          database.db
            .insert(clarificationMessageAttachments)
            .values({
              messageId: message.id,
              requestId: request.id,
              uploadedById: customer.id,
              storageName: attachment.storageName,
              originalName: attachment.originalName,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              sha256: attachment.sha256,
              createdAt: now,
            })
            .run();
        }

        const updated = database.db
          .update(requests)
          .set({
            progressStatus: "UNSCHEDULED",
            needsCustomerReply: false,
            version: sql`${requests.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(requests.id, request.id),
              eq(requests.version, request.version),
            ),
          )
          .returning()
          .get();
        if (!updated) {
          throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
        }
        database.db
          .insert(requestEvents)
          .values({
            requestId: request.id,
            actorId: customer.id,
            eventType: "PROGRESS_CHANGED",
            visibility: "PUBLIC",
            payload: { from: "COMPLETED", to: "UNSCHEDULED" },
            createdAt: now,
          })
          .run();
        return {
          id: updated.id,
          progressStatus: "UNSCHEDULED" as const,
          version: updated.version,
        };
      })
      .immediate();

    discardStagedAttachments(staged, paths);
    return actionSuccess(result);
  } catch (error) {
    cleanup(staged, committed, paths);
    return failure(error);
  }
}
