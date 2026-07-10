import { and, eq } from "drizzle-orm";

import {
  AuthorizationError,
  requireCustomer,
} from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import { projectMemberships, projects, users } from "@/db/schema";
import type { AppDatabase, Project } from "@/db/types";

export function requireActiveCustomerProject(
  database: AppDatabase,
  actor: AuthenticatedUser,
  projectId: number,
): Project {
  const customer = requireCustomer(actor);
  const project = database.db
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
        eq(projectMemberships.customerId, customer.id),
      ),
    )
    .innerJoin(users, eq(users.id, projectMemberships.customerId))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.isActive, true),
        eq(users.role, "CUSTOMER"),
        eq(users.isActive, true),
        eq(users.mustChangePassword, false),
      ),
    )
    .get();

  if (!project) throw new AuthorizationError("FORBIDDEN");
  return project;
}
