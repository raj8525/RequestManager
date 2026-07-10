import { and, eq, sql } from "drizzle-orm";
import type { ZodError, ZodType } from "zod";

import {
  AuthorizationError,
  requireCustomer,
  requireDeveloper,
} from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import {
  projectMemberships,
  projects,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import type {
  AppDatabase,
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

import { requireActiveCustomerProject } from "../projects/authorization";
import { assertValidStateCombination, canEditRequest, decidePause } from "./policy";
import { presentRequest, type RequestDto } from "./presenter";
import {
  changeProgressSchema,
  createRequestSchema,
  requestLifecycleSchema,
  updateOwnRequestSchema,
  type ChangeProgressInput,
  type CreateRequestInput,
  type RequestLifecycleInput,
  type UpdateOwnRequestInput,
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

function authorizeActor(actor: AuthenticatedUser): ActionFailure | null {
  if (!actor.mustChangePassword) return null;
  return actionFailure("PASSWORD_CHANGE_REQUIRED", "请先修改密码");
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

function runRequestWrite<T>(
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

function requireMutableRequestAccess(
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
      .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
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

function updateWithEvent(
  database: AppDatabase,
  actor: AuthenticatedUser,
  current: Request,
  values: Partial<
    Pick<
      Request,
      | "content"
      | "requestType"
      | "priority"
      | "progressStatus"
      | "recordStatus"
    >
  >,
  eventType: RequestEventType,
  payload: Record<string, unknown> | null,
): Request {
  const progressStatus = values.progressStatus ?? current.progressStatus;
  const recordStatus = values.recordStatus ?? current.recordStatus;
  assertValidStateCombination(progressStatus, recordStatus);

  const now = new Date();
  const updated = database.db
    .update(requests)
    .set({
      ...values,
      version: sql`${requests.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(requests.id, current.id), eq(requests.version, current.version)))
    .returning()
    .get();
  if (!updated) throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");

  appendEvent(database, updated.id, actor.id, eventType, payload, now);
  return updated;
}

export async function createRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: CreateRequestInput,
): Promise<ActionResult<RequestDto>> {
  const denied = authorizeRole(actor, "CUSTOMER");
  if (denied) return denied;
  const parsed = parseInput(createRequestSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runRequestWrite(database, actor, (currentActor) => {
    requireActiveCustomerProject(database, currentActor, parsed.data.projectId);

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
      const matches =
        existing.projectId === parsed.data.projectId &&
        existing.content === parsed.data.content &&
        existing.requestType === parsed.data.requestType &&
        existing.priority === parsed.data.priority;
      if (!matches) {
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
    return created;
  });
  if (!write.ok) return write.result;
  return actionSuccess(presentRequest(write.data));
}

export async function updateOwnRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: UpdateOwnRequestInput,
): Promise<ActionResult<RequestDto>> {
  const denied = authorizeRole(actor, "CUSTOMER");
  if (denied) return denied;
  const parsed = parseInput(updateOwnRequestSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runRequestWrite(database, actor, (currentActor) => {
    const current = requireMutableRequestAccess(
      database,
      currentActor,
      parsed.data.requestId,
    );
    assertExpectedVersion(current, parsed.data.expectedVersion);
    if (!canEditRequest(currentActor, current)) {
      throw new DomainError("FORBIDDEN", "当前需求不可编辑");
    }
    return updateWithEvent(
      database,
      currentActor,
      current,
      {
        content: parsed.data.content,
        requestType: parsed.data.requestType,
        priority: parsed.data.priority,
      },
      "REQUEST_UPDATED",
      null,
    );
  });
  if (!write.ok) return write.result;
  return actionSuccess(presentRequest(write.data));
}

export async function changeProgress(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: ChangeProgressInput,
): Promise<ActionResult<RequestDto>> {
  const denied = authorizeRole(actor, "DEVELOPER");
  if (denied) return denied;
  const parsed = parseInput(changeProgressSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runRequestWrite(database, actor, (currentActor) => {
    const current = requireMutableRequestAccess(
      database,
      currentActor,
      parsed.data.requestId,
    );
    assertExpectedVersion(current, parsed.data.expectedVersion);
    if (current.recordStatus !== "ACTIVE") {
      throw new DomainError("CONFLICT", "请先将需求恢复为正常状态");
    }
    if (current.progressStatus === parsed.data.progressStatus) {
      throw new DomainError("CONFLICT", "需求已经是该进度状态");
    }
    return updateWithEvent(
      database,
      currentActor,
      current,
      { progressStatus: parsed.data.progressStatus },
      "PROGRESS_CHANGED",
      { from: current.progressStatus, to: parsed.data.progressStatus },
    );
  });
  if (!write.ok) return write.result;
  return actionSuccess(presentRequest(write.data));
}

export async function pauseRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: RequestLifecycleInput,
): Promise<ActionResult<RequestDto>> {
  const denied = authorizeActor(actor);
  if (denied) return denied;
  const parsed = parseInput(requestLifecycleSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runRequestWrite(database, actor, (currentActor) => {
    const current = requireMutableRequestAccess(
      database,
      currentActor,
      parsed.data.requestId,
    );
    assertExpectedVersion(current, parsed.data.expectedVersion);
    const decision = decidePause(currentActor, current);
    if (!decision.allowed) {
      throw new DomainError(
        decision.reason === "INVALID_STATE" ? "CONFLICT" : "FORBIDDEN",
        decision.reason === "INVALID_STATE" ? "当前需求不能暂停" : "无权暂停该需求",
      );
    }
    return updateWithEvent(
      database,
      currentActor,
      current,
      { recordStatus: "PAUSED" },
      "REQUEST_PAUSED",
      { from: "ACTIVE", to: "PAUSED" },
    );
  });
  if (!write.ok) return write.result;
  return actionSuccess(presentRequest(write.data));
}

export async function resumeRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: RequestLifecycleInput,
): Promise<ActionResult<RequestDto>> {
  return developerRecordTransition(
    database,
    actor,
    input,
    "REQUEST_RESUMED",
    (current) => {
      if (current.recordStatus !== "PAUSED") {
        throw new DomainError("CONFLICT", "只有已暂停需求可以恢复");
      }
      return "ACTIVE";
    },
  );
}

export async function archiveRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: RequestLifecycleInput,
): Promise<ActionResult<RequestDto>> {
  return developerRecordTransition(
    database,
    actor,
    input,
    "REQUEST_ARCHIVED",
    (current) => {
      if (current.recordStatus === "ARCHIVED") {
        throw new DomainError("CONFLICT", "需求已经归档");
      }
      return "ARCHIVED";
    },
  );
}

export async function restoreRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: RequestLifecycleInput,
): Promise<ActionResult<RequestDto>> {
  return developerRecordTransition(
    database,
    actor,
    input,
    "REQUEST_RESTORED",
    (current) => {
      if (current.recordStatus !== "ARCHIVED") {
        throw new DomainError("CONFLICT", "只有已归档需求可以恢复");
      }
      return "ACTIVE";
    },
  );
}

async function developerRecordTransition(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: RequestLifecycleInput,
  eventType: Extract<
    RequestEventType,
    "REQUEST_RESUMED" | "REQUEST_ARCHIVED" | "REQUEST_RESTORED"
  >,
  decideTarget: (current: Request) => Request["recordStatus"],
): Promise<ActionResult<RequestDto>> {
  const denied = authorizeRole(actor, "DEVELOPER");
  if (denied) return denied;
  const parsed = parseInput(requestLifecycleSchema, input);
  if (!parsed.ok) return parsed.result;

  const write = runRequestWrite(database, actor, (currentActor) => {
    const current = requireMutableRequestAccess(
      database,
      currentActor,
      parsed.data.requestId,
    );
    assertExpectedVersion(current, parsed.data.expectedVersion);
    const target = decideTarget(current);
    return updateWithEvent(
      database,
      currentActor,
      current,
      { recordStatus: target },
      eventType,
      { from: current.recordStatus, to: target },
    );
  });
  if (!write.ok) return write.result;
  return actionSuccess(presentRequest(write.data));
}
