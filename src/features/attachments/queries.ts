import { asc, eq } from "drizzle-orm";

import type { AuthenticatedUser } from "@/auth/session-service";
import { attachments } from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import { getRequestDetail } from "@/features/requests/queries";
import {
  actionFailure,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";

import type { AttachmentDto } from "./service";

export function listAuthorizedAttachments(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): ActionResult<AttachmentDto[]> {
  const request = getRequestDetail(database, actor, requestId);
  if (!request.ok) return actionFailure(request.code, request.message, request.fieldErrors);

  return actionSuccess(
    database.db
      .select({
        id: attachments.id,
        originalName: attachments.originalName,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(eq(attachments.requestId, requestId))
      .orderBy(asc(attachments.id))
      .all()
      .map((attachment) => ({
        ...attachment,
        url: `/api/attachments/${attachment.id}`,
      })),
  );
}
