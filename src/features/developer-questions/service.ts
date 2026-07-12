import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type { ZodType } from "zod";

import { AuthorizationError } from "@/auth/authorization";
import type { AuthenticatedUser } from "@/auth/session-service";
import {
  developerQuestionAttachments,
  developerQuestionEvents,
  developerQuestionMessages,
  developerQuestions,
  projectMemberships,
  projects,
  users,
} from "@/db/schema";
import type { AppDatabase, DeveloperQuestion, DeveloperQuestionEventType } from "@/db/types";
import { commitStagedAttachments, discardStagedAttachments, removeCommittedAttachments, stageAttachments, type CommittedAttachment, type StagedAttachment, type StoragePaths } from "@/features/attachments/storage";
import { actionFailure, actionSuccess, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { DomainError } from "@/lib/domain-error";

import { presentDeveloperQuestion, type DeveloperQuestionDto } from "./presenter";
import { appendDeveloperQuestionMessageSchema, createDeveloperQuestionSchema, markDeveloperQuestionSeenSchema, type AppendDeveloperQuestionMessageInput, type CreateDeveloperQuestionInput, type MarkDeveloperQuestionSeenInput } from "./schemas";

function parse<T>(schema: ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; result: ActionFailure } {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, result: actionFailure("INVALID_INPUT", "提交的信息无效") };
}

function failure(error: unknown): ActionFailure {
  if (error instanceof DomainError) return actionFailure(error.code, error.message, error.fieldErrors);
  if (error instanceof AuthorizationError) return actionFailure(error.code, error.code === "PASSWORD_CHANGE_REQUIRED" ? "请先修改密码" : "无权执行此操作");
  return actionFailure("SYSTEM_UNAVAILABLE", "系统暂时不可用，请稍后重试");
}

function liveActor(database: AppDatabase, actor: AuthenticatedUser): AuthenticatedUser {
  const row = database.db.select().from(users).where(eq(users.id, actor.id)).get();
  if (!row || !row.isActive || row.role !== actor.role) throw new AuthorizationError("FORBIDDEN");
  if (row.mustChangePassword) throw new AuthorizationError("PASSWORD_CHANGE_REQUIRED");
  return { ...row, mustChangePassword: false };
}

function activeProject(database: AppDatabase, projectId: number) {
  const project = database.db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new DomainError("NOT_FOUND", "项目不存在");
  if (!project.isActive) throw new DomainError("STATE_CONFLICT", "停用项目中的提问为只读");
  return project;
}

function accessibleQuestion(database: AppDatabase, actor: AuthenticatedUser, questionId: number): DeveloperQuestion {
  const question = database.db.select().from(developerQuestions).where(eq(developerQuestions.id, questionId)).get();
  if (!question) throw new DomainError("NOT_FOUND", "开发者提问不存在");
  if (actor.role === "CUSTOMER") {
    const member = database.db.select().from(projectMemberships).where(and(eq(projectMemberships.projectId, question.projectId), eq(projectMemberships.customerId, actor.id))).get();
    if (!member) throw new DomainError("NOT_FOUND", "开发者提问不存在");
  }
  return question;
}

function event(database: AppDatabase, questionId: number, actorId: number, eventType: DeveloperQuestionEventType, createdAt: Date) {
  database.db.insert(developerQuestionEvents).values({ questionId, actorId, eventType, createdAt }).run();
}

function fingerprint(content: string, projectId: number, staged: readonly StagedAttachment[]) {
  return createHash("sha256").update(JSON.stringify({ projectId, content, attachments: staged.map(({ originalName, mimeType, sizeBytes, sha256 }) => ({ originalName, mimeType, sizeBytes, sha256 })) })).digest("hex");
}

function insertAttachments(database: AppDatabase, questionId: number, messageId: number | null, actorId: number, committed: readonly CommittedAttachment[], now: Date) {
  for (const item of committed) database.db.insert(developerQuestionAttachments).values({ questionId, messageId, uploadedById: actorId, storageName: item.storageName, originalName: item.originalName, mimeType: item.mimeType, sizeBytes: item.sizeBytes, sha256: item.sha256, createdAt: now }).run();
}

function clean(failures: ReturnType<typeof discardStagedAttachments>) {
  for (const item of failures) console.error(JSON.stringify({ event: "question_attachment_cleanup_failed", storageName: item.storageName, errorName: item.error instanceof Error ? item.error.name : "UnknownError" }));
}

export async function createDeveloperQuestion(database: AppDatabase, actor: AuthenticatedUser, input: CreateDeveloperQuestionInput, files: File[], paths: StoragePaths): Promise<ActionResult<DeveloperQuestionDto>> {
  const parsed = parse(createDeveloperQuestionSchema, input); if (!parsed.ok) return parsed.result;
  let staged: StagedAttachment[] = []; let committed: CommittedAttachment[] = [];
  try { staged = await stageAttachments(files, paths); } catch (error) { return failure(error); }
  try {
    const question = database.sqlite.transaction(() => {
      const current = liveActor(database, actor); if (current.role !== "DEVELOPER") throw new AuthorizationError("FORBIDDEN");
      activeProject(database, parsed.data.projectId);
      const existing = database.db.select().from(developerQuestions).where(and(eq(developerQuestions.createdById, current.id), eq(developerQuestions.idempotencyKey, parsed.data.idempotencyKey))).get();
      const payloadFingerprint = fingerprint(parsed.data.content, parsed.data.projectId, staged);
      if (existing) { if (existing.createPayloadFingerprint !== payloadFingerprint) throw new DomainError("CONFLICT", "幂等键已用于其他提问"); return existing; }
      const now = new Date();
      const created = database.db.insert(developerQuestions).values({ projectId: parsed.data.projectId, createdById: current.id, content: parsed.data.content, attentionStatus: "WAITING_CUSTOMER", idempotencyKey: parsed.data.idempotencyKey, createPayloadFingerprint: payloadFingerprint, createdAt: now, updatedAt: now }).returning().get();
      committed = commitStagedAttachments(staged, paths); insertAttachments(database, created.id, null, current.id, committed, now); event(database, created.id, current.id, "QUESTION_CREATED", now); return created;
    }).immediate();
    clean(discardStagedAttachments(staged, paths)); return actionSuccess(presentDeveloperQuestion(question));
  } catch (error) { clean(removeCommittedAttachments(committed, paths)); clean(discardStagedAttachments(staged, paths)); return failure(error); }
}

export type QuestionMessageDto = { id: number; questionId: number; author: { id: number; displayName: string }; authorRole: "CUSTOMER" | "DEVELOPER"; content: string; createdAt: Date; attachments: Array<{ id: number; originalName: string; mimeType: string; sizeBytes: number; createdAt: Date; url: string }> };

export async function appendDeveloperQuestionMessage(database: AppDatabase, actor: AuthenticatedUser, input: AppendDeveloperQuestionMessageInput, files: File[], paths: StoragePaths): Promise<ActionResult<{ question: DeveloperQuestionDto; message: QuestionMessageDto }>> {
  const parsed = parse(appendDeveloperQuestionMessageSchema, input); if (!parsed.ok) return parsed.result;
  let staged: StagedAttachment[] = []; let committed: CommittedAttachment[] = [];
  try { staged = await stageAttachments(files, paths); } catch (error) { return failure(error); }
  try {
    const result = database.sqlite.transaction(() => {
      const current = liveActor(database, actor); const question = accessibleQuestion(database, current, parsed.data.questionId); activeProject(database, question.projectId);
      const existing = database.db.select().from(developerQuestionMessages).where(and(eq(developerQuestionMessages.authorId, current.id), eq(developerQuestionMessages.idempotencyKey, parsed.data.idempotencyKey))).get();
      if (existing) { if (existing.questionId !== question.id || existing.content !== parsed.data.content) throw new DomainError("CONFLICT", "幂等键已用于其他消息"); return { question, message: existing, actor: current }; }
      if (question.version !== parsed.data.expectedVersion) throw new DomainError("CONFLICT", "提问已更新，请刷新后重试");
      const now = new Date(); const message = database.db.insert(developerQuestionMessages).values({ questionId: question.id, authorId: current.id, authorRole: current.role, content: parsed.data.content, idempotencyKey: parsed.data.idempotencyKey, createdAt: now }).returning().get();
      committed = commitStagedAttachments(staged, paths); insertAttachments(database, question.id, message.id, current.id, committed, now);
      const attentionStatus = current.role === "DEVELOPER" ? "WAITING_CUSTOMER" as const : "WAITING_DEVELOPER" as const;
      const updated = database.db.update(developerQuestions).set({ attentionStatus, version: sql`${developerQuestions.version} + 1`, updatedAt: now }).where(and(eq(developerQuestions.id, question.id), eq(developerQuestions.version, question.version))).returning().get();
      if (!updated) throw new DomainError("CONFLICT", "提问已更新，请刷新后重试"); event(database, question.id, current.id, current.role === "DEVELOPER" ? "DEVELOPER_FOLLOWED_UP" : "CUSTOMER_REPLIED", now); return { question: updated, message, actor: current };
    }).immediate();
    clean(discardStagedAttachments(staged, paths));
    const attachments = database.db.select().from(developerQuestionAttachments).where(eq(developerQuestionAttachments.messageId, result.message.id)).all().map((a) => ({ id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt, url: `/api/developer-question-attachments/${a.id}` }));
    return actionSuccess({ question: presentDeveloperQuestion(result.question), message: { id: result.message.id, questionId: result.message.questionId, author: { id: result.actor.id, displayName: result.actor.displayName }, authorRole: result.message.authorRole, content: result.message.content, createdAt: result.message.createdAt, attachments } });
  } catch (error) { clean(removeCommittedAttachments(committed, paths)); clean(discardStagedAttachments(staged, paths)); return failure(error); }
}

export async function markDeveloperQuestionSeen(database: AppDatabase, actor: AuthenticatedUser, input: MarkDeveloperQuestionSeenInput): Promise<ActionResult<DeveloperQuestionDto>> {
  const parsed = parse(markDeveloperQuestionSeenSchema, input); if (!parsed.ok) return parsed.result;
  try {
    const updated = database.sqlite.transaction(() => { const current = liveActor(database, actor); if (current.role !== "DEVELOPER") throw new AuthorizationError("FORBIDDEN"); const question = accessibleQuestion(database, current, parsed.data.questionId); activeProject(database, question.projectId); if (question.version !== parsed.data.expectedVersion) throw new DomainError("CONFLICT", "提问已更新，请刷新后重试"); if (question.attentionStatus !== "WAITING_DEVELOPER") throw new DomainError("STATE_CONFLICT", "当前没有待开发者查看的回复"); const now = new Date(); const row = database.db.update(developerQuestions).set({ attentionStatus: "SEEN", version: sql`${developerQuestions.version} + 1`, updatedAt: now }).where(and(eq(developerQuestions.id, question.id), eq(developerQuestions.version, question.version))).returning().get(); if (!row) throw new DomainError("CONFLICT", "提问已更新，请刷新后重试"); event(database, question.id, current.id, "MARKED_SEEN", now); return row; }).immediate(); return actionSuccess(presentDeveloperQuestion(updated));
  } catch (error) { return failure(error); }
}
