import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate as runDrizzleMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import {
  clarificationMessageAttachments,
  clarificationMessages,
  completionNoteAttachments,
  completionNotes,
  privateNotes,
  projects,
  publicRemarkAttachments,
  publicRemarks,
  requests,
  users,
} from "@/db/schema";
import { createTestDatabase } from "@/../tests/helpers/test-database";

const expectedTables = [
  "attachments",
  "auth_throttle",
  "clarification_message_attachments",
  "clarification_messages",
  "completion_note_attachments",
  "completion_notes",
  "developer_question_attachments",
  "developer_question_events",
  "developer_question_messages",
  "developer_questions",
  "private_notes",
  "project_memberships",
  "projects",
  "public_remark_attachments",
  "public_remarks",
  "request_events",
  "requests",
  "sessions",
  "users",
] as const;

const expectedForeignKeys = [
  "attachments.request_id->requests.id",
  "attachments.uploaded_by_id->users.id",
  "clarification_messages.author_id->users.id",
  "clarification_messages.request_id->requests.id",
  "clarification_message_attachments.message_id->clarification_messages.id",
  "clarification_message_attachments.request_id->requests.id",
  "clarification_message_attachments.uploaded_by_id->users.id",
  "completion_note_attachments.completion_note_id->completion_notes.id",
  "completion_note_attachments.request_id->requests.id",
  "completion_note_attachments.uploaded_by_id->users.id",
  "completion_notes.request_id->requests.id",
  "completion_notes.updated_by_id->users.id",
  "developer_question_attachments.message_id->developer_question_messages.id",
  "developer_question_attachments.question_id->developer_questions.id",
  "developer_question_attachments.uploaded_by_id->users.id",
  "developer_question_events.actor_id->users.id",
  "developer_question_events.question_id->developer_questions.id",
  "developer_question_messages.author_id->users.id",
  "developer_question_messages.question_id->developer_questions.id",
  "developer_questions.created_by_id->users.id",
  "developer_questions.project_id->projects.id",
  "private_notes.developer_id->users.id",
  "private_notes.request_id->requests.id",
  "project_memberships.customer_id->users.id",
  "project_memberships.project_id->projects.id",
  "public_remarks.author_id->users.id",
  "public_remarks.request_id->requests.id",
  "public_remark_attachments.public_remark_id->public_remarks.id",
  "public_remark_attachments.request_id->requests.id",
  "public_remark_attachments.uploaded_by_id->users.id",
  "request_events.actor_id->users.id",
  "request_events.request_id->requests.id",
  "requests.created_by_id->users.id",
  "requests.project_id->projects.id",
  "sessions.user_id->users.id",
] as const;

type ForeignKeyRow = {
  from: string;
  table: string;
  to: string;
};

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: unknown[];
};

const migrationsSource = fileURLToPath(
  new URL("../../../drizzle/", import.meta.url),
);

describe("createDatabase", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it("enables foreign keys, WAL and a busy timeout", () => {
    const testDb = createTestDatabase();
    cleanups.push(testDb.cleanup);
    expect(testDb.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(testDb.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(testDb.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("enforces case-insensitive username uniqueness", () => {
    const testDb = createTestDatabase();
    cleanups.push(testDb.cleanup);
    testDb.db
      .insert(users)
      .values({
        username: "alice",
        displayName: "Alice",
        passwordHash: "hash",
        role: "CUSTOMER",
      })
      .run();

    expect(() =>
      testDb.db
        .insert(users)
        .values({
          username: "ALICE",
          displayName: "Other Alice",
          passwordHash: "hash",
          role: "CUSTOMER",
        })
        .run(),
    ).toThrow();
  });

  it("enforces case-insensitive project-code uniqueness", () => {
    const testDb = createTestDatabase();
    cleanups.push(testDb.cleanup);
    testDb.db.insert(projects).values({ code: "APP", name: "Application" }).run();

    expect(() =>
      testDb.db
        .insert(projects)
        .values({ code: "app", name: "Duplicate application" })
        .run(),
    ).toThrow();

    const index = testDb.sqlite
      .prepare(
        "select sql from sqlite_master where type = 'index' and name = 'projects_code_unique'",
      )
      .get() as { sql: string };
    expect(index.sql).toContain('lower("code")');
  });

  it("finds migrations independently of the current working directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "request-manager-cwd-test-"));
    const database = createDatabase(join(directory, "test.db"));
    const originalWorkingDirectory = process.cwd();
    cleanups.push(() => {
      closeDatabase(database);
      rmSync(directory, { force: true, recursive: true });
    });

    expect(() => {
      process.chdir(directory);
      try {
        migrateDatabase(database);
      } finally {
        process.chdir(originalWorkingDirectory);
      }
    }).not.toThrow();
  });

  it("migrates every required table and foreign key", () => {
    const testDb = createTestDatabase();
    cleanups.push(testDb.cleanup);
    const tables = testDb.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle_%' order by name",
      )
      .all() as Array<{ name: string }>;
    const foreignKeys = expectedTables.flatMap((table) =>
      (testDb.sqlite.pragma(`foreign_key_list(${table})`) as ForeignKeyRow[]).map(
        (foreignKey) =>
          `${table}.${foreignKey.from}->${foreignKey.table}.${foreignKey.to}`,
      ),
    );

    expect(tables.map(({ name }) => name)).toEqual(expectedTables);
    expect(foreignKeys.sort()).toEqual([...expectedForeignKeys].sort());
  });

  it("adds an empty immutable creation fingerprint and nullable title when upgrading existing requests", () => {
    const directory = mkdtempSync(join(tmpdir(), "request-manager-migration-test-"));
    const legacyMigrations = join(directory, "legacy-migrations");
    mkdirSync(join(legacyMigrations, "meta"), { recursive: true });
    for (const file of [
      "0000_initial.sql",
      "0001_project-code-case-insensitive.sql",
    ]) {
      copyFileSync(join(migrationsSource, file), join(legacyMigrations, file));
    }
    const journal = JSON.parse(
      readFileSync(join(migrationsSource, "meta", "_journal.json"), "utf8"),
    ) as MigrationJournal;
    writeFileSync(
      join(legacyMigrations, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
    );

    const database = createDatabase(join(directory, "upgrade.db"));
    cleanups.push(() => {
      closeDatabase(database);
      rmSync(directory, { force: true, recursive: true });
    });
    runDrizzleMigrations(database.db, { migrationsFolder: legacyMigrations });

    const customerId = database.sqlite
      .prepare(
        "insert into users (username, display_name, password_hash, role) values (?, ?, ?, ?)",
      )
      .run("legacy-customer", "Legacy customer", "hash", "CUSTOMER")
      .lastInsertRowid;
    const projectId = database.sqlite
      .prepare("insert into projects (code, name) values (?, ?)")
      .run("LEGACY", "Legacy project").lastInsertRowid;
    database.sqlite
      .prepare(
        "insert into requests (project_id, created_by_id, content, request_type, priority, idempotency_key) values (?, ?, ?, ?, ?, ?)",
      )
      .run(
        projectId,
        customerId,
        "A legacy sufficiently detailed request",
        "BUG",
        "NORMAL",
        "legacy-key",
      );

    migrateDatabase(database);

    const columns = database.sqlite.pragma("table_info(requests)") as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    expect(columns).toContainEqual(
      expect.objectContaining({
        name: "create_payload_fingerprint",
        notnull: 1,
        dflt_value: "''",
      }),
    );
    expect(columns).toContainEqual(
      expect.objectContaining({
        name: "title",
        notnull: 0,
        dflt_value: null,
      }),
    );
    expect(
      database.sqlite
        .prepare(
          "select title, content, create_payload_fingerprint as createPayloadFingerprint from requests where id = 1",
        )
        .get(),
    ).toEqual({
      title: null,
      content: "A legacy sufficiently detailed request",
      createPayloadFingerprint: "",
    });
  });

  it("enforces append idempotency and one private note per developer", () => {
    const testDb = createTestDatabase();
    cleanups.push(testDb.cleanup);
    const customerId = testDb.db
      .insert(users)
      .values({
        username: "customer",
        displayName: "Customer",
        passwordHash: "hash",
        role: "CUSTOMER",
      })
      .returning({ id: users.id })
      .get().id;
    const developerId = testDb.db
      .insert(users)
      .values({
        username: "developer",
        displayName: "Developer",
        passwordHash: "hash",
        role: "DEVELOPER",
      })
      .returning({ id: users.id })
      .get().id;
    const projectId = testDb.db
      .insert(projects)
      .values({ code: "PROJECT", name: "Project" })
      .returning({ id: projects.id })
      .get().id;
    const requestInput = {
      projectId,
      createdById: customerId,
      content: "A complete request body",
      requestType: "BUG" as const,
      idempotencyKey: "request-key",
    };
    const requestId = testDb.db
      .insert(requests)
      .values(requestInput)
      .returning({ id: requests.id })
      .get().id;

    expect(() => testDb.db.insert(requests).values(requestInput).run()).toThrow();

    const remarkInput = {
      requestId,
      authorId: developerId,
      content: "Public note",
      idempotencyKey: "remark-key",
    };
    testDb.db.insert(publicRemarks).values(remarkInput).run();
    expect(() => testDb.db.insert(publicRemarks).values(remarkInput).run()).toThrow();

    const clarificationInput = {
      requestId,
      authorId: developerId,
      authorRole: "DEVELOPER" as const,
      content: "Please clarify",
      idempotencyKey: "clarification-key",
    };
    testDb.db.insert(clarificationMessages).values(clarificationInput).run();
    expect(() =>
      testDb.db.insert(clarificationMessages).values(clarificationInput).run(),
    ).toThrow();

    const privateNoteInput = {
      requestId,
      developerId,
      content: "Private note",
    };
    testDb.db.insert(privateNotes).values(privateNoteInput).run();
    expect(() => testDb.db.insert(privateNotes).values(privateNoteInput).run()).toThrow();

    const remark = testDb.db.select().from(publicRemarks).get()!;
    const clarification = testDb.db.select().from(clarificationMessages).get()!;
    const completionNote = testDb.db
      .insert(completionNotes)
      .values({ requestId, updatedById: developerId, content: "Completed" })
      .returning()
      .get();
    expect(() =>
      testDb.db
        .insert(completionNotes)
        .values({ requestId, updatedById: developerId, content: "Duplicate" })
        .run(),
    ).toThrow();

    testDb.db.insert(publicRemarkAttachments).values({
      publicRemarkId: remark.id,
      requestId,
      uploadedById: developerId,
      storageName: "aa/remark.png",
      originalName: "remark.png",
      mimeType: "image/png",
      sizeBytes: 1,
      sha256: "a".repeat(64),
    }).run();
    testDb.db.insert(clarificationMessageAttachments).values({
      messageId: clarification.id,
      requestId,
      uploadedById: developerId,
      storageName: "bb/clarification.png",
      originalName: "clarification.png",
      mimeType: "image/png",
      sizeBytes: 1,
      sha256: "b".repeat(64),
    }).run();
    testDb.db.insert(completionNoteAttachments).values({
      completionNoteId: completionNote.id,
      requestId,
      uploadedById: developerId,
      storageName: "cc/completion.png",
      originalName: "completion.png",
      mimeType: "image/png",
      sizeBytes: 1,
      sha256: "c".repeat(64),
    }).run();
  });
});
