import { asc } from "drizzle-orm";

import { AuthorizationError, requireDeveloper } from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import { projects } from "@/db/schema";
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
