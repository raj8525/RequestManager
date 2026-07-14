import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const userRoles = ["CUSTOMER", "DEVELOPER"] as const;
export const requestTypes = ["BUG", "CHANGE", "NEW_FEATURE"] as const;
export const requestPriorities = ["URGENT", "IMPORTANT", "NORMAL"] as const;
export const requestProgressStatuses = [
  "UNSCHEDULED",
  "SCHEDULED",
  "COMPLETED",
] as const;
export const requestRecordStatuses = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const requestEventTypes = [
  "REQUEST_CREATED",
  "REQUEST_UPDATED",
  "PROGRESS_CHANGED",
  "REQUEST_PAUSED",
  "REQUEST_RESUMED",
  "REQUEST_ARCHIVED",
  "REQUEST_RESTORED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_REMOVED",
  "PUBLIC_REMARK_ADDED",
  "CLARIFICATION_ASKED",
  "CLARIFICATION_REPLIED",
] as const;
export const requestEventVisibilities = ["PUBLIC", "DEVELOPER"] as const;
export const developerQuestionAttentionStatuses = [
  "WAITING_CUSTOMER",
  "WAITING_DEVELOPER",
  "SEEN",
] as const;
export const developerQuestionEventTypes = [
  "QUESTION_CREATED",
  "DEVELOPER_FOLLOWED_UP",
  "CUSTOMER_REPLIED",
  "MARKED_SEEN",
] as const;

const nowInMilliseconds = sql`(unixepoch() * 1000)`;

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: userRoles }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("users_username_unique").on(sql`lower(${table.username})`),
    check("users_role_check", sql`${table.role} in ('CUSTOMER', 'DEVELOPER')`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const authThrottle = sqliteTable(
  "auth_throttle",
  {
    normalizedUsername: text("normalized_username").notNull(),
    sourceHash: text("source_hash").notNull(),
    failureCount: integer("failure_count").notNull().default(0),
    windowStartedAt: integer("window_started_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    primaryKey({
      name: "auth_throttle_identity_pk",
      columns: [table.normalizedUsername, table.sourceHash],
    }),
    check("auth_throttle_failure_count_check", sql`${table.failureCount} >= 0`),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [uniqueIndex("projects_code_unique").on(sql`lower(${table.code})`)],
);

export const projectMemberships = sqliteTable(
  "project_memberships",
  {
    customerId: integer("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    primaryKey({
      name: "project_memberships_customer_project_pk",
      columns: [table.customerId, table.projectId],
    }),
    index("project_memberships_project_id_idx").on(table.projectId),
  ],
);

export const developerQuestions = sqliteTable(
  "developer_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").notNull().references(() => projects.id),
    createdById: integer("created_by_id").notNull().references(() => users.id),
    content: text("content").notNull(),
    attentionStatus: text("attention_status", {
      enum: developerQuestionAttentionStatuses,
    }).notNull().default("WAITING_CUSTOMER"),
    version: integer("version").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    createPayloadFingerprint: text("create_payload_fingerprint").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("developer_questions_creator_idempotency_unique").on(table.createdById, table.idempotencyKey),
    index("developer_questions_project_id_idx").on(table.projectId),
    index("developer_questions_attention_updated_idx").on(table.attentionStatus, table.updatedAt, table.id),
    check("developer_questions_attention_check", sql`${table.attentionStatus} in ('WAITING_CUSTOMER', 'WAITING_DEVELOPER', 'SEEN')`),
    check("developer_questions_version_check", sql`${table.version} >= 1`),
  ],
);

export const developerQuestionMessages = sqliteTable(
  "developer_question_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id").notNull().references(() => developerQuestions.id, { onDelete: "cascade" }),
    authorId: integer("author_id").notNull().references(() => users.id),
    authorRole: text("author_role", { enum: userRoles }).notNull(),
    content: text("content").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("developer_question_messages_author_idempotency_unique").on(table.authorId, table.idempotencyKey),
    index("developer_question_messages_question_id_idx").on(table.questionId, table.createdAt, table.id),
    check("developer_question_messages_author_role_check", sql`${table.authorRole} in ('CUSTOMER', 'DEVELOPER')`),
  ],
);

export const developerQuestionAttachments = sqliteTable(
  "developer_question_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id").notNull().references(() => developerQuestions.id, { onDelete: "cascade" }),
    messageId: integer("message_id").references(() => developerQuestionMessages.id, { onDelete: "cascade" }),
    uploadedById: integer("uploaded_by_id").notNull().references(() => users.id),
    storageName: text("storage_name").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("developer_question_attachments_storage_name_unique").on(table.storageName),
    index("developer_question_attachments_question_id_idx").on(table.questionId, table.messageId),
    check("developer_question_attachments_size_check", sql`${table.sizeBytes} >= 0`),
  ],
);

export const developerQuestionEvents = sqliteTable(
  "developer_question_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id").notNull().references(() => developerQuestions.id, { onDelete: "cascade" }),
    actorId: integer("actor_id").references(() => users.id),
    eventType: text("event_type", { enum: developerQuestionEventTypes }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    index("developer_question_events_question_id_idx").on(table.questionId, table.createdAt, table.id),
    check("developer_question_events_type_check", sql`${table.eventType} in ('QUESTION_CREATED', 'DEVELOPER_FOLLOWED_UP', 'CUSTOMER_REPLIED', 'MARKED_SEEN')`),
  ],
);

export const requests = sqliteTable(
  "requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => users.id),
    title: text("title"),
    content: text("content").notNull(),
    requestType: text("request_type", { enum: requestTypes }).notNull(),
    priority: text("priority", { enum: requestPriorities }).notNull().default("NORMAL"),
    progressStatus: text("progress_status", { enum: requestProgressStatuses })
      .notNull()
      .default("UNSCHEDULED"),
    recordStatus: text("record_status", { enum: requestRecordStatuses })
      .notNull()
      .default("ACTIVE"),
    needsCustomerReply: integer("needs_customer_reply", { mode: "boolean" })
      .notNull()
      .default(false),
    version: integer("version").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    createPayloadFingerprint: text("create_payload_fingerprint")
      .notNull()
      .default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("requests_creator_idempotency_unique").on(
      table.createdById,
      table.idempotencyKey,
    ),
    index("requests_project_id_idx").on(table.projectId),
    index("requests_created_by_id_idx").on(table.createdById),
    index("requests_updated_at_idx").on(table.updatedAt, table.id),
    check(
      "requests_type_check",
      sql`${table.requestType} in ('BUG', 'CHANGE', 'NEW_FEATURE')`,
    ),
    check(
      "requests_priority_check",
      sql`${table.priority} in ('URGENT', 'IMPORTANT', 'NORMAL')`,
    ),
    check(
      "requests_progress_status_check",
      sql`${table.progressStatus} in ('UNSCHEDULED', 'SCHEDULED', 'COMPLETED')`,
    ),
    check(
      "requests_record_status_check",
      sql`${table.recordStatus} in ('ACTIVE', 'PAUSED', 'ARCHIVED')`,
    ),
    check("requests_version_check", sql`${table.version} >= 1`),
    check(
      "requests_paused_state_check",
      sql`${table.recordStatus} <> 'PAUSED' or ${table.progressStatus} = 'SCHEDULED'`,
    ),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    uploadedById: integer("uploaded_by_id")
      .notNull()
      .references(() => users.id),
    storageName: text("storage_name").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("attachments_storage_name_unique").on(table.storageName),
    index("attachments_request_id_idx").on(table.requestId),
    check("attachments_size_bytes_check", sql`${table.sizeBytes} >= 0`),
  ],
);

export const publicRemarks = sqliteTable(
  "public_remarks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("public_remarks_author_idempotency_unique").on(
      table.authorId,
      table.idempotencyKey,
    ),
    index("public_remarks_request_id_idx").on(table.requestId, table.createdAt, table.id),
  ],
);

export const privateNotes = sqliteTable(
  "private_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    developerId: integer("developer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("private_notes_request_developer_unique").on(
      table.requestId,
      table.developerId,
    ),
    index("private_notes_developer_id_idx").on(table.developerId),
  ],
);

export const clarificationMessages = sqliteTable(
  "clarification_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    authorRole: text("author_role", { enum: userRoles }).notNull(),
    content: text("content").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("clarification_messages_author_idempotency_unique").on(
      table.authorId,
      table.idempotencyKey,
    ),
    index("clarification_messages_request_id_idx").on(
      table.requestId,
      table.createdAt,
      table.id,
    ),
    check(
      "clarification_messages_author_role_check",
      sql`${table.authorRole} in ('CUSTOMER', 'DEVELOPER')`,
    ),
  ],
);

export const requestEvents = sqliteTable(
  "request_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    actorId: integer("actor_id").references(() => users.id),
    eventType: text("event_type", { enum: requestEventTypes }).notNull(),
    visibility: text("visibility", { enum: requestEventVisibilities })
      .notNull()
      .default("PUBLIC"),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    index("request_events_request_id_idx").on(table.requestId, table.createdAt, table.id),
    check(
      "request_events_type_check",
      sql`${table.eventType} in ('REQUEST_CREATED', 'REQUEST_UPDATED', 'PROGRESS_CHANGED', 'REQUEST_PAUSED', 'REQUEST_RESUMED', 'REQUEST_ARCHIVED', 'REQUEST_RESTORED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED', 'PUBLIC_REMARK_ADDED', 'CLARIFICATION_ASKED', 'CLARIFICATION_REPLIED')`,
    ),
    check(
      "request_events_visibility_check",
      sql`${table.visibility} in ('PUBLIC', 'DEVELOPER')`,
    ),
  ],
);
