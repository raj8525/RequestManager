import { asc } from "drizzle-orm";

import { AuthorizationError, requireDeveloper } from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import { projectMemberships, users } from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import { actionFailure, actionSuccess, type ActionResult } from "@/lib/action-result";

import type { ManagedUser } from "./service";

export type ManageableUserDto = ManagedUser & { projectIds: number[] };

export function listManageableUsers(
  database: AppDatabase,
  actor: AuthenticatedUser,
): ActionResult<ManagedUser[]> {
  try {
    requireDeveloper(actor);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return actionFailure(
      error.code,
      error.code === "PASSWORD_CHANGE_REQUIRED" ? "请先修改密码" : "无权查看账号列表",
    );
  }

  return actionSuccess(
    database.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(asc(users.username), asc(users.id))
      .all(),
  );
}

export function listManageableUsersWithMemberships(
  database: AppDatabase,
  actor: AuthenticatedUser,
): ActionResult<ManageableUserDto[]> {
  const usersResult = listManageableUsers(database, actor);
  if (!usersResult.ok) return usersResult;

  const memberships = database.db
    .select({
      customerId: projectMemberships.customerId,
      projectId: projectMemberships.projectId,
    })
    .from(projectMemberships)
    .orderBy(
      asc(projectMemberships.customerId),
      asc(projectMemberships.projectId),
    )
    .all();
  const projectIdsByCustomer = new Map<number, number[]>();
  for (const membership of memberships) {
    const projectIds = projectIdsByCustomer.get(membership.customerId) ?? [];
    projectIds.push(membership.projectId);
    projectIdsByCustomer.set(membership.customerId, projectIds);
  }

  return actionSuccess(
    usersResult.data.map((user) => ({
      ...user,
      projectIds:
        user.role === "CUSTOMER"
          ? (projectIdsByCustomer.get(user.id) ?? [])
          : [],
    })),
  );
}
