import { and, eq } from "drizzle-orm";

import type { AuthenticatedUser } from "@/auth/session-service";
import { projectMemberships, projects } from "@/db/schema";
import type { AppDatabase, UserRole } from "@/db/types";

export class AuthorizationError extends Error {
  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "PASSWORD_CHANGE_REQUIRED",
  ) {
    super(code);
    this.name = "AuthorizationError";
  }
}

type UserWithRole<Role extends UserRole> = AuthenticatedUser & { role: Role };

function requireRole<Role extends UserRole>(
  actor: AuthenticatedUser | null | undefined,
  role: Role,
): UserWithRole<Role> {
  if (!actor) throw new AuthorizationError("UNAUTHENTICATED");
  if (actor.mustChangePassword) {
    throw new AuthorizationError("PASSWORD_CHANGE_REQUIRED");
  }
  if (actor.role !== role) throw new AuthorizationError("FORBIDDEN");
  return actor as UserWithRole<Role>;
}

export function requireCustomer(
  actor: AuthenticatedUser | null | undefined,
): UserWithRole<"CUSTOMER"> {
  return requireRole(actor, "CUSTOMER");
}

export function requireDeveloper(
  actor: AuthenticatedUser | null | undefined,
): UserWithRole<"DEVELOPER"> {
  return requireRole(actor, "DEVELOPER");
}

export function canAccessProject(
  database: AppDatabase,
  actor: AuthenticatedUser,
  projectId: number,
): boolean {
  if (actor.mustChangePassword) return false;

  if (actor.role === "DEVELOPER") {
    return Boolean(
      database.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get(),
    );
  }

  return Boolean(
    database.db
      .select({ projectId: projectMemberships.projectId })
      .from(projectMemberships)
      .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
      .where(
        and(
          eq(projectMemberships.customerId, actor.id),
          eq(projectMemberships.projectId, projectId),
        ),
      )
      .get(),
  );
}
