import { asc, eq } from "drizzle-orm";

import type { AuthenticatedUser } from "@/auth/session-service";
import { completionNoteAttachments, completionNotes, users } from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import { getRequestDetail } from "@/features/requests/queries";
import { actionFailure, actionSuccess, type ActionResult } from "@/lib/action-result";

export type CompletionNoteDto = { id: number; requestId: number; content: string; updatedBy: { id: number; displayName: string }; createdAt: Date; updatedAt: Date; attachments: Array<{ id: number; originalName: string; mimeType: string; sizeBytes: number; createdAt: Date; url: string }> };

export function getCompletionNote(database: AppDatabase, actor: AuthenticatedUser, requestId: number): ActionResult<CompletionNoteDto | null> {
  const request = getRequestDetail(database, actor, requestId);
  if (!request.ok) return actionFailure(request.code, request.message, request.fieldErrors);
  const row = database.db.select({ note: completionNotes, displayName: users.displayName }).from(completionNotes).innerJoin(users, eq(users.id, completionNotes.updatedById)).where(eq(completionNotes.requestId, requestId)).get();
  if (!row) return actionSuccess(null);
  const attachments = database.db.select({ id: completionNoteAttachments.id, originalName: completionNoteAttachments.originalName, mimeType: completionNoteAttachments.mimeType, sizeBytes: completionNoteAttachments.sizeBytes, createdAt: completionNoteAttachments.createdAt }).from(completionNoteAttachments).where(eq(completionNoteAttachments.completionNoteId, row.note.id)).orderBy(asc(completionNoteAttachments.id)).all().map((item) => ({ ...item, url: `/api/completion-note-attachments/${item.id}` }));
  return actionSuccess({ id: row.note.id, requestId, content: row.note.content, updatedBy: { id: row.note.updatedById, displayName: row.displayName }, createdAt: row.note.createdAt, updatedAt: row.note.updatedAt, attachments });
}
