import { and, eq } from "drizzle-orm";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  attachments,
  projectMemberships,
  requests,
  users,
} from "@/db/schema";
import type { AppDatabase, Attachment } from "@/db/types";

export function getAuthorizedAttachment(
  database: AppDatabase,
  actor: AuthenticatedUser | null | undefined,
  attachmentId: number,
): Attachment | null {
  if (
    !actor ||
    actor.mustChangePassword ||
    !Number.isSafeInteger(attachmentId) ||
    attachmentId <= 0
  ) {
    return null;
  }

  const currentActor = database.db
    .select({
      role: users.role,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .get();
  if (
    !currentActor ||
    !currentActor.isActive ||
    currentActor.mustChangePassword ||
    currentActor.role !== actor.role
  ) {
    return null;
  }

  const row = database.db
    .select({ attachment: attachments, projectId: requests.projectId })
    .from(attachments)
    .innerJoin(requests, eq(attachments.requestId, requests.id))
    .where(eq(attachments.id, attachmentId))
    .get();
  if (!row) return null;
  if (currentActor.role === "DEVELOPER") return row.attachment;

  const membership = database.db
    .select({ projectId: projectMemberships.projectId })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.customerId, actor.id),
        eq(projectMemberships.projectId, row.projectId),
      ),
    )
    .get();
  return membership ? row.attachment : null;
}
