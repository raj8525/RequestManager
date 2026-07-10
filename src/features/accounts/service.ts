import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { ZodError, ZodType } from "zod";

import { AuthorizationError, requireDeveloper } from "@/auth/authorization";
import { hashPassword } from "@/auth/password";
import type { AuthenticatedUser } from "@/auth/session-service";
import { revokeUserSessions } from "@/auth/session-service";
import { projectMemberships, projects, users } from "@/db/schema";
import type { AppDatabase, User } from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";

import {
  createUserSchema,
  replaceCustomerMembershipsSchema,
  resetUserPasswordSchema,
  setUserActiveSchema,
  updateUserIdentitySchema,
  type CreateUserInput,
  type ReplaceCustomerMembershipsInput,
  type ResetUserPasswordInput,
  type SetUserActiveInput,
  type UpdateUserIdentityInput,
} from "./schemas";

export type ManagedUser = Pick<
  User,
  | "id"
  | "username"
  | "displayName"
  | "role"
  | "isActive"
  | "mustChangePassword"
  | "createdAt"
  | "updatedAt"
>;

function managedUser(user: User): ManagedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

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

function authorize(actor: AuthenticatedUser): ActionFailure | null {
  try {
    requireDeveloper(actor);
    return null;
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return actionFailure(
      error.code,
      error.code === "PASSWORD_CHANGE_REQUIRED" ? "请先修改密码" : "无权执行此操作",
    );
  }
}

export async function createUser(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: CreateUserInput,
): Promise<ActionResult<ManagedUser>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(createUserSchema, input);
  if (!parsed.ok) return parsed.result;

  const passwordHash = await hashPassword(parsed.data.password);
  const now = new Date();
  const outcome = database.sqlite.transaction(() => {
    const duplicate = database.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${parsed.data.username}`)
      .get();
    if (duplicate) return null;

    return database.db
      .insert(users)
      .values({
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash,
        role: parsed.data.role,
        isActive: true,
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }).immediate();

  return outcome
    ? actionSuccess(managedUser(outcome))
    : actionFailure("CONFLICT", "用户名已被使用", {
        username: ["用户名已被使用"],
      });
}

export async function updateUserIdentity(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: UpdateUserIdentityInput,
): Promise<ActionResult<ManagedUser>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(updateUserIdentitySchema, input);
  if (!parsed.ok) return parsed.result;

  const outcome = database.sqlite.transaction(() => {
    const current = database.db
      .select()
      .from(users)
      .where(eq(users.id, parsed.data.userId))
      .get();
    if (!current) return { kind: "missing" as const };

    if (parsed.data.username !== undefined) {
      const duplicate = database.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            sql`lower(${users.username}) = ${parsed.data.username}`,
            ne(users.id, current.id),
          ),
        )
        .get();
      if (duplicate) return { kind: "duplicate" as const };
    }

    const updated = database.db
      .update(users)
      .set({
        username: parsed.data.username ?? current.username,
        displayName: parsed.data.displayName ?? current.displayName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, current.id))
      .returning()
      .get();
    return { kind: "updated" as const, user: updated };
  }).immediate();

  if (outcome.kind === "missing") return actionFailure("NOT_FOUND", "账号不存在");
  if (outcome.kind === "duplicate") {
    return actionFailure("CONFLICT", "用户名已被使用", {
      username: ["用户名已被使用"],
    });
  }
  return actionSuccess(managedUser(outcome.user));
}

export async function resetUserPassword(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: ResetUserPasswordInput,
): Promise<ActionResult<ManagedUser>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(resetUserPasswordSchema, input);
  if (!parsed.ok) return parsed.result;

  const passwordHash = await hashPassword(parsed.data.password);
  const updated = database.sqlite.transaction(() => {
    const current = database.db
      .select()
      .from(users)
      .where(eq(users.id, parsed.data.userId))
      .get();
    if (!current) return null;

    const user = database.db
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, current.id))
      .returning()
      .get();
    revokeUserSessions(database, current.id);
    return user;
  }).immediate();

  return updated
    ? actionSuccess(managedUser(updated))
    : actionFailure("NOT_FOUND", "账号不存在");
}

export async function setUserActive(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: SetUserActiveInput,
): Promise<ActionResult<ManagedUser>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(setUserActiveSchema, input);
  if (!parsed.ok) return parsed.result;

  const outcome = database.sqlite.transaction(() => {
    const current = database.db
      .select()
      .from(users)
      .where(eq(users.id, parsed.data.userId))
      .get();
    if (!current) return { kind: "missing" as const };

    if (!parsed.data.active && current.isActive && current.role === "DEVELOPER") {
      const activeDevelopers = database.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "DEVELOPER"), eq(users.isActive, true)))
        .all();
      if (current.id === actor.id || activeDevelopers.length <= 1) {
        return { kind: "last-developer" as const };
      }
    }

    const user = database.db
      .update(users)
      .set({ isActive: parsed.data.active, updatedAt: new Date() })
      .where(eq(users.id, current.id))
      .returning()
      .get();
    if (!parsed.data.active) revokeUserSessions(database, current.id);
    return { kind: "updated" as const, user };
  }).immediate();

  if (outcome.kind === "missing") return actionFailure("NOT_FOUND", "账号不存在");
  if (outcome.kind === "last-developer") {
    return actionFailure("LAST_DEVELOPER", "不能停用自己或最后一个启用的开发者");
  }
  return actionSuccess(managedUser(outcome.user));
}

export async function replaceCustomerMemberships(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: ReplaceCustomerMembershipsInput,
): Promise<ActionResult<{ customerId: number; projectIds: number[] }>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(replaceCustomerMembershipsSchema, input);
  if (!parsed.ok) return parsed.result;

  const projectIds = [...new Set(parsed.data.projectIds)];
  const outcome = database.sqlite.transaction(() => {
    const customer = database.db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, parsed.data.customerId))
      .get();
    if (!customer || customer.role !== "CUSTOMER" || !customer.isActive) {
      return { kind: "invalid-customer" as const };
    }

    const existingProjectIds =
      projectIds.length === 0
        ? []
        : database.db
            .select({ id: projects.id })
            .from(projects)
            .where(inArray(projects.id, projectIds))
            .all()
            .map((project) => project.id);
    if (existingProjectIds.length !== projectIds.length) {
      return { kind: "missing-project" as const };
    }

    database.db
      .delete(projectMemberships)
      .where(eq(projectMemberships.customerId, customer.id))
      .run();
    if (projectIds.length > 0) {
      database.db
        .insert(projectMemberships)
        .values(projectIds.map((projectId) => ({ customerId: customer.id, projectId })))
        .run();
    }
    return { kind: "replaced" as const };
  }).immediate();

  if (outcome.kind === "invalid-customer") {
    return actionFailure("INVALID_INPUT", "只能为启用的客户账号分配项目", {
      customerId: ["只能为启用的客户账号分配项目"],
    });
  }
  if (outcome.kind === "missing-project") {
    return actionFailure("INVALID_INPUT", "所选项目不存在", {
      projectIds: ["所选项目不存在"],
    });
  }
  return actionSuccess({ customerId: parsed.data.customerId, projectIds });
}
