import { and, asc, eq } from "drizzle-orm";

import {
  AuthorizationError,
  requireCustomer,
  requireDeveloper,
} from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import { projectMemberships, projects, users } from "@/db/schema";
import type { AppDatabase, Project } from "@/db/types";
import { actionFailure, actionSuccess, type ActionResult } from "@/lib/action-result";

export function listManageableProjects(
  database: AppDatabase,
  actor: AuthenticatedUser,
): ActionResult<Project[]> {
  try {
    requireDeveloper(actor);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return actionFailure(
      error.code,
      error.code === "PASSWORD_CHANGE_REQUIRED" ? "请先修改密码" : "无权查看项目列表",
    );
  }

  return actionSuccess(
    database.db
      .select()
      .from(projects)
      .orderBy(asc(projects.code), asc(projects.id))
      .all(),
  );
}

export function listAccessibleProjects(
  database: AppDatabase,
  actor: AuthenticatedUser,
): ActionResult<Project[]> {
  if (actor.role === "DEVELOPER") return listManageableProjects(database, actor);
  try {
    requireCustomer(actor);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return actionFailure(
      error.code,
      error.code === "PASSWORD_CHANGE_REQUIRED" ? "请先修改密码" : "无权查看项目列表",
    );
  }

  const current = database.db
    .select({ isActive: users.isActive, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, actor.id))
    .get();
  if (!current?.isActive || current.mustChangePassword) {
    return actionFailure("FORBIDDEN", "无权查看项目列表");
  }

  return actionSuccess(
    database.db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        description: projects.description,
        isActive: projects.isActive,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, projects.id),
          eq(projectMemberships.customerId, actor.id),
        ),
      )
      .orderBy(asc(projects.code), asc(projects.id))
      .all(),
  );
}
