import { and, asc, eq, isNull } from "drizzle-orm";

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
import type { AppDatabase } from "@/db/types";
import { actionFailure, actionSuccess, type ActionResult } from "@/lib/action-result";

import { presentDeveloperQuestion, type DeveloperQuestionDto } from "./presenter";
import type { QuestionMessageDto } from "./service";

export type QuestionAttachmentDto = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  url: string;
};

export type DeveloperQuestionDetailDto = DeveloperQuestionDto & {
  project: { id: number; code: string; name: string; isActive: boolean };
  createdBy: { id: number; displayName: string };
  attachments: QuestionAttachmentDto[];
};

function canAccess(database: AppDatabase, actor: AuthenticatedUser, questionId: number) {
  const question = database.db.select().from(developerQuestions).where(eq(developerQuestions.id, questionId)).get();
  if (!question) return null;
  const live = database.db.select().from(users).where(eq(users.id, actor.id)).get();
  if (!live || !live.isActive || live.mustChangePassword || live.role !== actor.role) return null;
  if (actor.role === "CUSTOMER") {
    const member = database.db.select().from(projectMemberships).where(and(eq(projectMemberships.projectId, question.projectId), eq(projectMemberships.customerId, actor.id))).get();
    if (!member) return null;
  }
  return question;
}

function attachments(database: AppDatabase, questionId: number, messageId: number | null): QuestionAttachmentDto[] {
  return database.db.select().from(developerQuestionAttachments).where(messageId === null ? and(eq(developerQuestionAttachments.questionId, questionId), isNull(developerQuestionAttachments.messageId)) : eq(developerQuestionAttachments.messageId, messageId)).orderBy(asc(developerQuestionAttachments.id)).all().map((item) => ({ id: item.id, originalName: item.originalName, mimeType: item.mimeType, sizeBytes: item.sizeBytes, createdAt: item.createdAt, url: `/api/developer-question-attachments/${item.id}` }));
}

export function getDeveloperQuestionDetail(database: AppDatabase, actor: AuthenticatedUser, questionId: number): ActionResult<DeveloperQuestionDetailDto> {
  const question = canAccess(database, actor, questionId);
  if (!question) return actionFailure("NOT_FOUND", "开发者提问不存在");
  const project = database.db.select().from(projects).where(eq(projects.id, question.projectId)).get();
  const creator = database.db.select().from(users).where(eq(users.id, question.createdById)).get();
  if (!project || !creator) return actionFailure("NOT_FOUND", "开发者提问不存在");
  return actionSuccess({ ...presentDeveloperQuestion(question), project: { id: project.id, code: project.code, name: project.name, isActive: project.isActive }, createdBy: { id: creator.id, displayName: creator.displayName }, attachments: attachments(database, question.id, null) });
}

export function listDeveloperQuestionMessages(database: AppDatabase, actor: AuthenticatedUser, questionId: number): ActionResult<QuestionMessageDto[]> {
  if (!canAccess(database, actor, questionId)) return actionFailure("NOT_FOUND", "开发者提问不存在");
  const rows = database.db.select({ message: developerQuestionMessages, displayName: users.displayName }).from(developerQuestionMessages).innerJoin(users, eq(users.id, developerQuestionMessages.authorId)).where(eq(developerQuestionMessages.questionId, questionId)).orderBy(asc(developerQuestionMessages.createdAt), asc(developerQuestionMessages.id)).all();
  return actionSuccess(rows.map(({ message, displayName }) => ({ id: message.id, questionId: message.questionId, author: { id: message.authorId, displayName }, authorRole: message.authorRole, content: message.content, createdAt: message.createdAt, attachments: attachments(database, questionId, message.id) })));
}

export function listDeveloperQuestionEvents(database: AppDatabase, actor: AuthenticatedUser, questionId: number) {
  if (!canAccess(database, actor, questionId)) return actionFailure("NOT_FOUND", "开发者提问不存在");
  return actionSuccess(database.db.select({ id: developerQuestionEvents.id, eventType: developerQuestionEvents.eventType, createdAt: developerQuestionEvents.createdAt, actorId: users.id, displayName: users.displayName }).from(developerQuestionEvents).leftJoin(users, eq(users.id, developerQuestionEvents.actorId)).where(eq(developerQuestionEvents.questionId, questionId)).orderBy(asc(developerQuestionEvents.createdAt), asc(developerQuestionEvents.id)).all());
}

export function getDeveloperQuestionAttachment(database: AppDatabase, actor: AuthenticatedUser, attachmentId: number) {
  const attachment = database.db.select().from(developerQuestionAttachments).where(eq(developerQuestionAttachments.id, attachmentId)).get();
  if (!attachment || !canAccess(database, actor, attachment.questionId)) return actionFailure("NOT_FOUND", "截图不存在");
  return actionSuccess(attachment);
}
