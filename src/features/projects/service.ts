import { and, eq, ne, sql } from "drizzle-orm";
import type { ZodError, ZodType } from "zod";

import { AuthorizationError, requireDeveloper } from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import { projects } from "@/db/schema";
import type { AppDatabase, Project } from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";

import {
  createProjectSchema,
  setProjectActiveSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type SetProjectActiveInput,
  type UpdateProjectInput,
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

export async function createProject(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: CreateProjectInput,
): Promise<ActionResult<Project>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(createProjectSchema, input);
  if (!parsed.ok) return parsed.result;

  const now = new Date();
  const project = database.sqlite.transaction(() => {
    const duplicate = database.db
      .select({ id: projects.id })
      .from(projects)
      .where(sql`lower(${projects.code}) = ${parsed.data.code.toLowerCase()}`)
      .get();
    if (duplicate) return null;
    return database.db
      .insert(projects)
      .values({
        code: parsed.data.code,
        name: parsed.data.name,
        description: parsed.data.description,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }).immediate();

  return project
    ? actionSuccess(project)
    : actionFailure("CONFLICT", "项目编号已被使用", {
        code: ["项目编号已被使用"],
      });
}

export async function updateProject(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: UpdateProjectInput,
): Promise<ActionResult<Project>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(updateProjectSchema, input);
  if (!parsed.ok) return parsed.result;

  const outcome = database.sqlite.transaction(() => {
    const current = database.db
      .select()
      .from(projects)
      .where(eq(projects.id, parsed.data.projectId))
      .get();
    if (!current) return { kind: "missing" as const };

    if (parsed.data.code !== undefined) {
      const duplicate = database.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            sql`lower(${projects.code}) = ${parsed.data.code.toLowerCase()}`,
            ne(projects.id, current.id),
          ),
        )
        .get();
      if (duplicate) return { kind: "duplicate" as const };
    }

    const project = database.db
      .update(projects)
      .set({
        code: parsed.data.code ?? current.code,
        name: parsed.data.name ?? current.name,
        description: parsed.data.description ?? current.description,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, current.id))
      .returning()
      .get();
    return { kind: "updated" as const, project };
  }).immediate();

  if (outcome.kind === "missing") return actionFailure("NOT_FOUND", "项目不存在");
  if (outcome.kind === "duplicate") {
    return actionFailure("CONFLICT", "项目编号已被使用", {
      code: ["项目编号已被使用"],
    });
  }
  return actionSuccess(outcome.project);
}

export async function setProjectActive(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: SetProjectActiveInput,
): Promise<ActionResult<Project>> {
  const denied = authorize(actor);
  if (denied) return denied;
  const parsed = parseInput(setProjectActiveSchema, input);
  if (!parsed.ok) return parsed.result;

  const project = database.sqlite.transaction(() => {
    const current = database.db
      .select()
      .from(projects)
      .where(eq(projects.id, parsed.data.projectId))
      .get();
    if (!current) return null;
    return database.db
      .update(projects)
      .set({ isActive: parsed.data.active, updatedAt: new Date() })
      .where(eq(projects.id, current.id))
      .returning()
      .get();
  }).immediate();

  return project
    ? actionSuccess(project)
    : actionFailure("NOT_FOUND", "项目不存在");
}
