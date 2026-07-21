import { and, eq, inArray, sql } from "drizzle-orm";

import type { AuthenticatedUser } from "@/auth/session-service";
import { completionNoteAttachments, completionNotes, requestEvents, requests, users } from "@/db/schema";
import type { AppDatabase, CompletionNoteAttachment } from "@/db/types";
import { commitStagedAttachments, discardStagedAttachments, removeCommittedAttachments, stageAttachments, type CommittedAttachment, type StagedAttachment, type StoragePaths } from "@/features/attachments/storage";
import { validateAttachmentLimits } from "@/features/attachments/validation";
import { presentRequest, type RequestDto } from "@/features/requests/presenter";
import { actionFailure, actionSuccess, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { DomainError } from "@/lib/domain-error";

import { getCompletionNote, type CompletionNoteDto } from "./queries";
import { saveCompletionNoteSchema, type SaveCompletionNoteInput } from "./schemas";

function failure(error: unknown): ActionFailure { return error instanceof DomainError ? actionFailure(error.code, error.message, error.fieldErrors) : actionFailure("SYSTEM_UNAVAILABLE", "系统暂时不可用，请稍后重试"); }

export async function saveCompletionNote(database: AppDatabase, actor: AuthenticatedUser, input: SaveCompletionNoteInput, files: File[], paths: StoragePaths): Promise<ActionResult<{ request: RequestDto; note: CompletionNoteDto | null }>> {
  const parsed = saveCompletionNoteSchema.safeParse(input); if (!parsed.success) return actionFailure("INVALID_INPUT", "提交的信息无效");
  let staged: StagedAttachment[] = []; let committed: CommittedAttachment[] = []; let removed: CompletionNoteAttachment[] = [];
  try { staged = await stageAttachments(files, paths); } catch (error) { return failure(error); }
  try {
    const updatedRequest = database.sqlite.transaction(() => {
      const live = database.db.select().from(users).where(eq(users.id, actor.id)).get();
      if (!live || !live.isActive || live.mustChangePassword || live.role !== "DEVELOPER" || actor.role !== "DEVELOPER") throw new DomainError("FORBIDDEN", "无权执行此操作");
      const request = database.db.select().from(requests).where(eq(requests.id, parsed.data.requestId)).get();
      if (!request) throw new DomainError("NOT_FOUND", "需求不存在");
      if (request.recordStatus !== "ACTIVE") throw new DomainError("STATE_CONFLICT", "暂停或归档需求不能修改完成说明");
      if (request.version !== parsed.data.expectedVersion) throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
      const existing = database.db.select().from(completionNotes).where(eq(completionNotes.requestId, request.id)).get();
      const existingAttachments = existing ? database.db.select().from(completionNoteAttachments).where(eq(completionNoteAttachments.completionNoteId, existing.id)).all() : [];
      const retainedIds = new Set(parsed.data.retainedAttachmentIds);
      if (parsed.data.retainedAttachmentIds.some((id) => !existingAttachments.some((item) => item.id === id))) throw new DomainError("NOT_FOUND", "截图不存在");
      const retained = existingAttachments.filter((item) => retainedIds.has(item.id)); removed = existingAttachments.filter((item) => !retainedIds.has(item.id));
      validateAttachmentLimits(staged, retained);
      const now = new Date();
      const shouldKeepNote = Boolean(parsed.data.content || retained.length || staged.length);
      let note = existing;
      if (shouldKeepNote) {
        note = existing
          ? database.db.update(completionNotes).set({ content: parsed.data.content, updatedById: live.id, updatedAt: now }).where(eq(completionNotes.id, existing.id)).returning().get()
          : database.db.insert(completionNotes).values({ requestId: request.id, content: parsed.data.content, updatedById: live.id, createdAt: now, updatedAt: now }).returning().get();
        if (removed.length) database.db.delete(completionNoteAttachments).where(inArray(completionNoteAttachments.id, removed.map((item) => item.id))).run();
        committed = commitStagedAttachments(staged, paths);
        for (const item of committed) database.db.insert(completionNoteAttachments).values({ completionNoteId: note.id, requestId: request.id, uploadedById: live.id, storageName: item.storageName, originalName: item.originalName, mimeType: item.mimeType, sizeBytes: item.sizeBytes, sha256: item.sha256, createdAt: now }).run();
      } else if (existing) {
        database.db.delete(completionNotes).where(eq(completionNotes.id, existing.id)).run();
      }
      const progressChanged = parsed.data.completeRequest && request.progressStatus !== "COMPLETED";
      const updated = database.db.update(requests).set({ progressStatus: progressChanged ? "COMPLETED" : request.progressStatus, version: sql`${requests.version} + 1`, updatedAt: now }).where(and(eq(requests.id, request.id), eq(requests.version, request.version))).returning().get();
      if (!updated) throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
      if (progressChanged) database.db.insert(requestEvents).values({ requestId: request.id, actorId: live.id, eventType: "PROGRESS_CHANGED", visibility: "PUBLIC", payload: { from: request.progressStatus, to: "COMPLETED" }, createdAt: now }).run();
      if (shouldKeepNote || existing) database.db.insert(requestEvents).values({ requestId: request.id, actorId: live.id, eventType: "REQUEST_UPDATED", visibility: "PUBLIC", payload: { field: "completionNote" }, createdAt: now }).run();
      return updated;
    }).immediate();
    discardStagedAttachments(staged, paths); removeCommittedAttachments(removed, paths);
    const note = getCompletionNote(database, { ...actor, role: "DEVELOPER" }, parsed.data.requestId);
    if (!note.ok) return note;
    return actionSuccess({ request: presentRequest(updatedRequest), note: note.data });
  } catch (error) { removeCommittedAttachments(committed, paths); discardStagedAttachments(staged, paths); return failure(error); }
}
