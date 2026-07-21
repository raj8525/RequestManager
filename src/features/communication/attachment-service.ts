import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  clarificationMessageAttachments,
  clarificationMessages,
  projectMemberships,
  projects,
  publicRemarkAttachments,
  publicRemarks,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import type { AppDatabase, Request } from "@/db/types";
import {
  commitStagedAttachments,
  discardStagedAttachments,
  removeCommittedAttachments,
  stageAttachments,
  type CommittedAttachment,
  type StagedAttachment,
  type StoragePaths,
} from "@/features/attachments/storage";
import { actionFailure, actionSuccess, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { DomainError } from "@/lib/domain-error";

import type { ClarificationMessageInput, AddPublicRemarkInput } from "./schemas";
import { addPublicRemarkSchema, clarificationMessageSchema } from "./schemas";
import type { ClarificationMessageDto, CommunicationAttachmentDto, PublicRemarkDto } from "./queries";

function failure(error: unknown): ActionFailure {
  if (error instanceof DomainError) return actionFailure(error.code, error.message, error.fieldErrors);
  return actionFailure("SYSTEM_UNAVAILABLE", "系统暂时不可用，请稍后重试");
}

function liveActor(database: AppDatabase, actor: AuthenticatedUser): AuthenticatedUser {
  const row = database.db.select().from(users).where(eq(users.id, actor.id)).get();
  if (!row || !row.isActive || row.role !== actor.role) throw new DomainError("FORBIDDEN", "无权执行此操作");
  if (row.mustChangePassword) throw new DomainError("PASSWORD_CHANGE_REQUIRED", "请先修改密码");
  return { ...row, mustChangePassword: false };
}

function writableRequest(database: AppDatabase, actor: AuthenticatedUser, requestId: number, expectedVersion: number): Request {
  const request = database.db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!request) throw new DomainError("NOT_FOUND", "需求不存在");
  if (actor.role === "CUSTOMER") {
    const access = database.db.select({ isActive: projects.isActive }).from(projectMemberships).innerJoin(projects, eq(projects.id, projectMemberships.projectId)).where(and(eq(projectMemberships.customerId, actor.id), eq(projectMemberships.projectId, request.projectId))).get();
    if (!access) throw new DomainError("NOT_FOUND", "需求不存在");
    if (!access.isActive) throw new DomainError("FORBIDDEN", "停用项目中的需求为只读");
  }
  if (request.recordStatus !== "ACTIVE") throw new DomainError("STATE_CONFLICT", "暂停或归档需求不能沟通");
  if (request.version !== expectedVersion) throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
  return request;
}

function fingerprint(content: string, staged: readonly StagedAttachment[]): string {
  return createHash("sha256").update(JSON.stringify({ content, attachments: staged.map(({ originalName, mimeType, sizeBytes, sha256 }) => ({ originalName, mimeType, sizeBytes, sha256 })) })).digest("hex");
}

function attachmentDto(kind: "remark" | "clarification", row: { id: number; originalName: string; mimeType: string; sizeBytes: number; createdAt: Date }): CommunicationAttachmentDto {
  return { ...row, url: kind === "remark" ? `/api/public-remark-attachments/${row.id}` : `/api/clarification-attachments/${row.id}` };
}

function cleanup(staged: readonly StagedAttachment[], committed: readonly CommittedAttachment[], paths: StoragePaths): void {
  removeCommittedAttachments(committed, paths);
  discardStagedAttachments(staged, paths);
}

export async function addPublicRemarkWithAttachments(database: AppDatabase, actor: AuthenticatedUser, input: AddPublicRemarkInput, files: File[], paths: StoragePaths): Promise<ActionResult<PublicRemarkDto>> {
  const parsed = addPublicRemarkSchema.safeParse(input);
  if (!parsed.success) return actionFailure("INVALID_INPUT", "提交的信息无效");
  let staged: StagedAttachment[] = []; let committed: CommittedAttachment[] = [];
  try { staged = await stageAttachments(files, paths); } catch (error) { return failure(error); }
  try {
    const result = database.sqlite.transaction(() => {
      const currentActor = liveActor(database, actor);
      if (currentActor.role !== "DEVELOPER") throw new DomainError("FORBIDDEN", "无权执行此操作");
      const current = writableRequest(database, currentActor, parsed.data.requestId, parsed.data.expectedVersion);
      const payloadFingerprint = fingerprint(parsed.data.content, staged);
      const existing = database.db.select().from(publicRemarks).where(and(eq(publicRemarks.authorId, currentActor.id), eq(publicRemarks.idempotencyKey, parsed.data.idempotencyKey))).get();
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) throw new DomainError("CONFLICT", "幂等键已用于其他公开备注");
        const attachments = database.db.select().from(publicRemarkAttachments).where(eq(publicRemarkAttachments.publicRemarkId, existing.id)).all();
        return { remark: existing, actor: currentActor, attachments };
      }
      const now = new Date();
      const remark = database.db.insert(publicRemarks).values({ requestId: current.id, authorId: currentActor.id, content: parsed.data.content, idempotencyKey: parsed.data.idempotencyKey, payloadFingerprint, createdAt: now }).returning().get();
      committed = commitStagedAttachments(staged, paths);
      const attachments = committed.map((item) => database.db.insert(publicRemarkAttachments).values({ publicRemarkId: remark.id, requestId: current.id, uploadedById: currentActor.id, storageName: item.storageName, originalName: item.originalName, mimeType: item.mimeType, sizeBytes: item.sizeBytes, sha256: item.sha256, createdAt: now }).returning().get());
      const updated = database.db.update(requests).set({ version: sql`${requests.version} + 1`, updatedAt: now }).where(and(eq(requests.id, current.id), eq(requests.version, current.version))).returning().get();
      if (!updated) throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
      database.db.insert(requestEvents).values({ requestId: current.id, actorId: currentActor.id, eventType: "PUBLIC_REMARK_ADDED", visibility: "PUBLIC", createdAt: now }).run();
      return { remark, actor: currentActor, attachments };
    }).immediate();
    discardStagedAttachments(staged, paths);
    return actionSuccess({ id: result.remark.id, requestId: result.remark.requestId, author: { id: result.actor.id, displayName: result.actor.displayName }, content: result.remark.content, createdAt: result.remark.createdAt, attachments: result.attachments.map((item) => attachmentDto("remark", item)) });
  } catch (error) { cleanup(staged, committed, paths); return failure(error); }
}

export async function appendClarificationWithAttachments(database: AppDatabase, actor: AuthenticatedUser, input: ClarificationMessageInput, files: File[], paths: StoragePaths): Promise<ActionResult<ClarificationMessageDto>> {
  const parsed = clarificationMessageSchema.safeParse(input);
  if (!parsed.success) return actionFailure("INVALID_INPUT", "提交的信息无效");
  let staged: StagedAttachment[] = []; let committed: CommittedAttachment[] = [];
  try { staged = await stageAttachments(files, paths); } catch (error) { return failure(error); }
  try {
    const result = database.sqlite.transaction(() => {
      const currentActor = liveActor(database, actor); const current = writableRequest(database, currentActor, parsed.data.requestId, parsed.data.expectedVersion);
      if (currentActor.role === "CUSTOMER" && !current.needsCustomerReply) throw new DomainError("STATE_CONFLICT", "该问题已被回复");
      const payloadFingerprint = fingerprint(parsed.data.content, staged);
      const existing = database.db.select().from(clarificationMessages).where(and(eq(clarificationMessages.authorId, currentActor.id), eq(clarificationMessages.idempotencyKey, parsed.data.idempotencyKey))).get();
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint || existing.authorRole !== currentActor.role) throw new DomainError("CONFLICT", "幂等键已用于其他澄清消息");
        const attachments = database.db.select().from(clarificationMessageAttachments).where(eq(clarificationMessageAttachments.messageId, existing.id)).all();
        return { message: existing, actor: currentActor, attachments };
      }
      const now = new Date();
      const message = database.db.insert(clarificationMessages).values({ requestId: current.id, authorId: currentActor.id, authorRole: currentActor.role, content: parsed.data.content, idempotencyKey: parsed.data.idempotencyKey, payloadFingerprint, createdAt: now }).returning().get();
      committed = commitStagedAttachments(staged, paths);
      const attachments = committed.map((item) => database.db.insert(clarificationMessageAttachments).values({ messageId: message.id, requestId: current.id, uploadedById: currentActor.id, storageName: item.storageName, originalName: item.originalName, mimeType: item.mimeType, sizeBytes: item.sizeBytes, sha256: item.sha256, createdAt: now }).returning().get());
      const updated = database.db.update(requests).set({ needsCustomerReply: currentActor.role === "DEVELOPER", version: sql`${requests.version} + 1`, updatedAt: now }).where(and(eq(requests.id, current.id), eq(requests.version, current.version))).returning().get();
      if (!updated) throw new DomainError("CONFLICT", "需求已更新，请刷新后重试");
      database.db.insert(requestEvents).values({ requestId: current.id, actorId: currentActor.id, eventType: currentActor.role === "DEVELOPER" ? "CLARIFICATION_ASKED" : "CLARIFICATION_REPLIED", visibility: "PUBLIC", createdAt: now }).run();
      return { message, actor: currentActor, attachments };
    }).immediate();
    discardStagedAttachments(staged, paths);
    return actionSuccess({ id: result.message.id, requestId: result.message.requestId, author: { id: result.actor.id, displayName: result.actor.displayName }, authorRole: result.message.authorRole, content: result.message.content, createdAt: result.message.createdAt, attachments: result.attachments.map((item) => attachmentDto("clarification", item)) });
  } catch (error) { cleanup(staged, committed, paths); return failure(error); }
}
