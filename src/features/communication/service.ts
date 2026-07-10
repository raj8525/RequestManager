import { and, eq, sql } from "drizzle-orm";
import type { ZodError, ZodType } from "zod";

import {
  AuthorizationError,
  requireCustomer,
  requireDeveloper,
} from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import {
  clarificationMessages,
  privateNotes,
  projectMemberships,
  projects,
  publicRemarks,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import type {
  AppDatabase,
  ClarificationMessage,
  PrivateNote,
  PublicRemark,
  Request,
  RequestEventType,
  UserRole,
} from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";
import { DomainError } from "@/lib/domain-error";

import { canWriteCommunication } from "./policy";
import type {
  ClarificationMessageDto,
  PrivateNoteDto,
  PublicRemarkDto,
} from "./queries";
import {
  addPublicRemarkSchema,
  clarificationMessageSchema,
  saveOwnPrivateNoteSchema,
  type AddPublicRemarkInput,
  type ClarificationMessageInput,
  type SaveOwnPrivateNoteInput,
} from "./schemas";

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

function errorFailure(error: unknown): ActionFailure | null {
  if (error instanceof DomainError) {
    return actionFailure(error.code, error.message, error.fieldErrors);
  }
  if (!(error instanceof AuthorizationError)) return null;
  return actionFailure(
    error.code,
    error.code === "PASSWORD_CHANGE_REQUIRED" ? "请先修改密码" : "无权执行此操作",
  );
}

function authorizeRole(
  actor: AuthenticatedUser,
  role: UserRole,
): ActionFailure | null {
  try {
    if (role === "CUSTOMER") requireCustomer(actor);
    else requireDeveloper(actor);
    return null;
  } catch (error) {
    const result = errorFailure(error);
    if (!result) throw error;
    return result;
  }
}

function requireLiveActor(
  database: AppDatabase,
  actor: AuthenticatedUser,
): AuthenticatedUser {
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

  if (!current || !current.isActive || current.role !== actor.role) {
    throw new AuthorizationError("FORBIDDEN");
  }
  if (current.mustChangePassword) {
    throw new AuthorizationError("PASSWORD_CHANGE_REQUIRED");
  }
  return {
    id: current.id,
    username: current.username,
    displayName: current.displayName,
    role: current.role,
    mustChangePassword: false,
  };
}

function runCommunicationWrite<T>(
  database: AppDatabase,
  actor: AuthenticatedUser,
  operation: (currentActor: AuthenticatedUser) => T,
): { ok: true; data: T } | { ok: false; result: ActionFailure } {
  try {
    const data = database.sqlite
      .transaction(() => operation(requireLiveActor(database, actor)))
      .immediate();
    return { ok: true, data };
  } catch (error) {
    const result = errorFailure(error);
    if (!result) throw error;
    return { ok: false, result };
  }
}

function requireRequestAccess(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): Request {
  const request = database.db
    .select()
    .from(requests)
    .where(eq(requests.id, requestId))
    .get();
  if (!request) throw new DomainError("NOT_FOUND", "需求不存在");

  if (actor.role === "CUSTOMER") {
    const access = database.db
      .select({ isActive: projects.isActive })
      .from(projectMemberships)
      .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
      .where(
        and(
          eq(projectMemberships.customerId, actor.id),
          eq(projectMemberships.projectId, request.projectId),
        ),
      )
      .get();
    if (!access) throw new DomainError("NOT_FOUND", "需求不存在");
    if (!access.isActive) {
      throw new DomainError("FORBIDDEN", "停用项目中的需求为只读");
    }
  }
  return request;
}

function assertExpectedVersion(request: Request, expectedVersion: number): void {
  if (request.version !== expectedVersion) {
    throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
  }
}

function assertCommunicationWritable(request: Request): void {
  if (!canWriteCommunication(request.recordStatus)) {
    throw new DomainError("STATE_CONFLICT", "暂停或归档需求不能沟通");
  }
}

function appendEvent(
  database: AppDatabase,
  requestId: number,
  actorId: number,
  eventType: RequestEventType,
  createdAt: Date,
): void {
  database.db
    .insert(requestEvents)
    .values({
      requestId,
      actorId,
      eventType,
      visibility: "PUBLIC",
      payload: null,
      createdAt,
    })
    .run();
}

function updateRequestAfterAppend(
  database: AppDatabase,
  current: Request,
  needsCustomerReply: boolean,
  updatedAt: Date,
): void {
  const updated = database.db
    .update(requests)
    .set({
      needsCustomerReply,
      version: sql`${requests.version} + 1`,
      updatedAt,
    })
    .where(and(eq(requests.id, current.id), eq(requests.version, current.version)))
    .returning({ id: requests.id })
    .get();
  if (!updated) throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
}

function presentPublicRemark(
  remark: PublicRemark,
  actor: AuthenticatedUser,
): PublicRemarkDto {
  return {
    id: remark.id,
    requestId: remark.requestId,
    author: { id: actor.id, displayName: actor.displayName },
    content: remark.content,
    createdAt: remark.createdAt,
  };
}

function presentPrivateNote(note: PrivateNote): PrivateNoteDto {
  return {
    id: note.id,
    requestId: note.requestId,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function presentClarificationMessage(
  message: ClarificationMessage,
  actor: AuthenticatedUser,
): ClarificationMessageDto {
  return {
    id: message.id,
    requestId: message.requestId,
    author: { id: actor.id, displayName: actor.displayName },
    authorRole: message.authorRole,
    content: message.content,
    createdAt: message.createdAt,
  };
}

function getExistingPublicRemark(
  database: AppDatabase,
  actorId: number,
  input: { requestId: number; content: string; idempotencyKey: string },
): PublicRemark | undefined {
  const existing = database.db
    .select()
    .from(publicRemarks)
    .where(
      and(
        eq(publicRemarks.authorId, actorId),
        eq(publicRemarks.idempotencyKey, input.idempotencyKey),
      ),
    )
    .get();
  if (
    existing &&
    (existing.requestId !== input.requestId || existing.content !== input.content)
  ) {
    throw new DomainError("CONFLICT", "幂等键已用于其他公开备注");
  }
  return existing;
}

function getExistingClarificationMessage(
  database: AppDatabase,
  actorId: number,
  authorRole: UserRole,
  input: { requestId: number; content: string; idempotencyKey: string },
): ClarificationMessage | undefined {
  const existing = database.db
    .select()
    .from(clarificationMessages)
    .where(
      and(
        eq(clarificationMessages.authorId, actorId),
        eq(clarificationMessages.idempotencyKey, input.idempotencyKey),
      ),
    )
    .get();
  if (
    existing &&
    (existing.requestId !== input.requestId ||
      existing.content !== input.content ||
      existing.authorRole !== authorRole)
  ) {
    throw new DomainError("CONFLICT", "幂等键已用于其他澄清消息");
  }
  return existing;
}

export async function addPublicRemark(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: AddPublicRemarkInput,
): Promise<ActionResult<PublicRemarkDto>> {
  const denied = authorizeRole(actor, "DEVELOPER");
  if (denied) return denied;
  const parsed = parseInput(addPublicRemarkSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runCommunicationWrite(database, actor, (currentActor) => {
    const current = requireRequestAccess(database, currentActor, parsed.data.requestId);
    assertCommunicationWritable(current);
    const existing = getExistingPublicRemark(
      database,
      currentActor.id,
      parsed.data,
    );
    if (existing) return { actor: currentActor, remark: existing };
    assertExpectedVersion(current, parsed.data.expectedVersion);

    const now = new Date();
    const remark = database.db
      .insert(publicRemarks)
      .values({
        requestId: current.id,
        authorId: currentActor.id,
        content: parsed.data.content,
        idempotencyKey: parsed.data.idempotencyKey,
        createdAt: now,
      })
      .returning()
      .get();
    updateRequestAfterAppend(
      database,
      current,
      current.needsCustomerReply,
      now,
    );
    appendEvent(database, current.id, currentActor.id, "PUBLIC_REMARK_ADDED", now);
    return { actor: currentActor, remark };
  });
  if (!write.ok) return write.result;
  return actionSuccess(
    presentPublicRemark(write.data.remark, write.data.actor),
  );
}

export async function saveOwnPrivateNote(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: SaveOwnPrivateNoteInput,
): Promise<ActionResult<PrivateNoteDto>> {
  const denied = authorizeRole(actor, "DEVELOPER");
  if (denied) return denied;
  const parsed = parseInput(saveOwnPrivateNoteSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runCommunicationWrite(database, actor, (currentActor) => {
    const current = requireRequestAccess(database, currentActor, parsed.data.requestId);
    assertCommunicationWritable(current);
    assertExpectedVersion(current, parsed.data.expectedVersion);

    const existing = database.db
      .select()
      .from(privateNotes)
      .where(
        and(
          eq(privateNotes.requestId, current.id),
          eq(privateNotes.developerId, currentActor.id),
        ),
      )
      .get();
    if (existing?.content === parsed.data.content) return existing;

    const now = new Date();
    return database.db
      .insert(privateNotes)
      .values({
        requestId: current.id,
        developerId: currentActor.id,
        content: parsed.data.content,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [privateNotes.requestId, privateNotes.developerId],
        set: { content: parsed.data.content, updatedAt: now },
      })
      .returning()
      .get();
  });
  if (!write.ok) return write.result;
  return actionSuccess(presentPrivateNote(write.data));
}

export async function askClarification(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: ClarificationMessageInput,
): Promise<ActionResult<ClarificationMessageDto>> {
  const denied = authorizeRole(actor, "DEVELOPER");
  if (denied) return denied;
  const parsed = parseInput(clarificationMessageSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runCommunicationWrite(database, actor, (currentActor) => {
    const current = requireRequestAccess(database, currentActor, parsed.data.requestId);
    assertCommunicationWritable(current);
    const existing = getExistingClarificationMessage(
      database,
      currentActor.id,
      "DEVELOPER",
      parsed.data,
    );
    if (existing) return { actor: currentActor, message: existing };
    assertExpectedVersion(current, parsed.data.expectedVersion);

    const now = new Date();
    const message = database.db
      .insert(clarificationMessages)
      .values({
        requestId: current.id,
        authorId: currentActor.id,
        authorRole: "DEVELOPER",
        content: parsed.data.content,
        idempotencyKey: parsed.data.idempotencyKey,
        createdAt: now,
      })
      .returning()
      .get();
    updateRequestAfterAppend(database, current, true, now);
    appendEvent(database, current.id, currentActor.id, "CLARIFICATION_ASKED", now);
    return { actor: currentActor, message };
  });
  if (!write.ok) return write.result;
  return actionSuccess(
    presentClarificationMessage(write.data.message, write.data.actor),
  );
}

export async function replyToClarification(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: ClarificationMessageInput,
): Promise<ActionResult<ClarificationMessageDto>> {
  const denied = authorizeRole(actor, "CUSTOMER");
  if (denied) return denied;
  const parsed = parseInput(clarificationMessageSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runCommunicationWrite(database, actor, (currentActor) => {
    const current = requireRequestAccess(database, currentActor, parsed.data.requestId);
    assertCommunicationWritable(current);
    const existing = getExistingClarificationMessage(
      database,
      currentActor.id,
      "CUSTOMER",
      parsed.data,
    );
    if (existing) return { actor: currentActor, message: existing };
    if (!current.needsCustomerReply) {
      throw new DomainError("STATE_CONFLICT", "该问题已被回复");
    }
    assertExpectedVersion(current, parsed.data.expectedVersion);

    const now = new Date();
    const message = database.db
      .insert(clarificationMessages)
      .values({
        requestId: current.id,
        authorId: currentActor.id,
        authorRole: "CUSTOMER",
        content: parsed.data.content,
        idempotencyKey: parsed.data.idempotencyKey,
        createdAt: now,
      })
      .returning()
      .get();
    updateRequestAfterAppend(database, current, false, now);
    appendEvent(database, current.id, currentActor.id, "CLARIFICATION_REPLIED", now);
    return { actor: currentActor, message };
  });
  if (!write.ok) return write.result;
  return actionSuccess(
    presentClarificationMessage(write.data.message, write.data.actor),
  );
}
