import { and, asc, eq } from "drizzle-orm";
import type { ZodError } from "zod";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  clarificationMessages,
  clarificationMessageAttachments,
  privateNotes,
  projectMemberships,
  publicRemarks,
  publicRemarkAttachments,
  requests,
  users,
} from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";

import { communicationRequestSchema } from "./schemas";

type MessageAuthorDto = {
  id: number;
  displayName: string;
};

export type PublicRemarkDto = {
  id: number;
  requestId: number;
  author: MessageAuthorDto;
  content: string;
  createdAt: Date;
  attachments?: CommunicationAttachmentDto[];
};

export type PrivateNoteDto = {
  id: number;
  requestId: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ClarificationMessageDto = {
  id: number;
  requestId: number;
  author: MessageAuthorDto;
  authorRole: "CUSTOMER" | "DEVELOPER";
  messageKind: "CONVERSATION" | "REOPEN_REASON";
  content: string;
  createdAt: Date;
  attachments?: CommunicationAttachmentDto[];
};

export type CommunicationAttachmentDto = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  url: string;
};

function remarkAttachments(database: AppDatabase, remarkId: number): CommunicationAttachmentDto[] {
  return database.db.select({ id: publicRemarkAttachments.id, originalName: publicRemarkAttachments.originalName, mimeType: publicRemarkAttachments.mimeType, sizeBytes: publicRemarkAttachments.sizeBytes, createdAt: publicRemarkAttachments.createdAt }).from(publicRemarkAttachments).where(eq(publicRemarkAttachments.publicRemarkId, remarkId)).orderBy(asc(publicRemarkAttachments.id)).all().map((item) => ({ ...item, url: `/api/public-remark-attachments/${item.id}` }));
}

function clarificationAttachments(database: AppDatabase, messageId: number): CommunicationAttachmentDto[] {
  return database.db.select({ id: clarificationMessageAttachments.id, originalName: clarificationMessageAttachments.originalName, mimeType: clarificationMessageAttachments.mimeType, sizeBytes: clarificationMessageAttachments.sizeBytes, createdAt: clarificationMessageAttachments.createdAt }).from(clarificationMessageAttachments).where(eq(clarificationMessageAttachments.messageId, messageId)).orderBy(asc(clarificationMessageAttachments.id)).all().map((item) => ({ ...item, url: `/api/clarification-attachments/${item.id}` }));
}

function validationErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    const key = typeof field === "string" ? field : "form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

function invalidInput(error: ZodError): ActionFailure {
  return actionFailure(
    "INVALID_INPUT",
    "查询条件无效",
    validationErrors(error),
  );
}

function getLiveActor(
  database: AppDatabase,
  actor: AuthenticatedUser,
): { ok: true; actor: AuthenticatedUser } | { ok: false; result: ActionFailure } {
  const current = database.db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .get();

  if (!current || !current.isActive || current.role !== actor.role) {
    return {
      ok: false,
      result: actionFailure("FORBIDDEN", "无权查看沟通记录"),
    };
  }
  if (current.mustChangePassword) {
    return {
      ok: false,
      result: actionFailure("PASSWORD_CHANGE_REQUIRED", "请先修改密码"),
    };
  }
  return {
    ok: true,
    actor: {
      id: current.id,
      username: current.username,
      displayName: current.displayName,
      role: current.role,
      mustChangePassword: false,
    },
  };
}

function canReadRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): boolean {
  if (actor.role === "DEVELOPER") {
    return Boolean(
      database.db
        .select({ id: requests.id })
        .from(requests)
        .where(eq(requests.id, requestId))
        .get(),
    );
  }

  return Boolean(
    database.db
      .select({ id: requests.id })
      .from(requests)
      .innerJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, requests.projectId),
          eq(projectMemberships.customerId, actor.id),
        ),
      )
      .where(eq(requests.id, requestId))
      .get(),
  );
}

function authorizeSharedQuery(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): ActionFailure | null {
  const parsed = communicationRequestSchema.safeParse({ requestId });
  if (!parsed.success) return invalidInput(parsed.error);
  const live = getLiveActor(database, actor);
  if (!live.ok) return live.result;
  return canReadRequest(database, live.actor, parsed.data.requestId)
    ? null
    : actionFailure("NOT_FOUND", "需求不存在");
}

export function listPublicRemarks(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): ActionResult<PublicRemarkDto[]> {
  const denied = authorizeSharedQuery(database, actor, requestId);
  if (denied) return denied;

  const rows = database.db
    .select({
      id: publicRemarks.id,
      requestId: publicRemarks.requestId,
      authorId: publicRemarks.authorId,
      authorDisplayName: users.displayName,
      content: publicRemarks.content,
      createdAt: publicRemarks.createdAt,
    })
    .from(publicRemarks)
    .innerJoin(users, eq(users.id, publicRemarks.authorId))
    .where(eq(publicRemarks.requestId, requestId))
    .orderBy(asc(publicRemarks.createdAt), asc(publicRemarks.id))
    .all();

  return actionSuccess(
    rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      author: { id: row.authorId, displayName: row.authorDisplayName },
      content: row.content,
      createdAt: row.createdAt,
      attachments: remarkAttachments(database, row.id),
    })),
  );
}

export function getOwnPrivateNote(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): ActionResult<PrivateNoteDto | null> {
  const parsed = communicationRequestSchema.safeParse({ requestId });
  if (!parsed.success) return invalidInput(parsed.error);
  const live = getLiveActor(database, actor);
  if (!live.ok) return live.result;
  if (live.actor.role !== "DEVELOPER") {
    return actionFailure("FORBIDDEN", "无权查看私人笔记");
  }
  if (!canReadRequest(database, live.actor, parsed.data.requestId)) {
    return actionFailure("NOT_FOUND", "需求不存在");
  }

  const note = database.db
    .select({
      id: privateNotes.id,
      requestId: privateNotes.requestId,
      content: privateNotes.content,
      createdAt: privateNotes.createdAt,
      updatedAt: privateNotes.updatedAt,
    })
    .from(privateNotes)
    .where(
      and(
        eq(privateNotes.requestId, parsed.data.requestId),
        eq(privateNotes.developerId, live.actor.id),
      ),
    )
    .get();

  return actionSuccess(note ?? null);
}

export function listClarificationMessages(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): ActionResult<ClarificationMessageDto[]> {
  const denied = authorizeSharedQuery(database, actor, requestId);
  if (denied) return denied;

  const rows = database.db
    .select({
      id: clarificationMessages.id,
      requestId: clarificationMessages.requestId,
      authorId: clarificationMessages.authorId,
      authorDisplayName: users.displayName,
      authorRole: clarificationMessages.authorRole,
      messageKind: clarificationMessages.messageKind,
      content: clarificationMessages.content,
      createdAt: clarificationMessages.createdAt,
    })
    .from(clarificationMessages)
    .innerJoin(users, eq(users.id, clarificationMessages.authorId))
    .where(eq(clarificationMessages.requestId, requestId))
    .orderBy(asc(clarificationMessages.createdAt), asc(clarificationMessages.id))
    .all();

  return actionSuccess(
    rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      author: { id: row.authorId, displayName: row.authorDisplayName },
      authorRole: row.authorRole,
      messageKind: row.messageKind,
      content: row.content,
      createdAt: row.createdAt,
      attachments: clarificationAttachments(database, row.id),
    })),
  );
}
