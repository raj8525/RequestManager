import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import {
  clarificationMessages,
  privateNotes,
  projects,
  publicRemarks,
  requests,
  users,
} from "@/db/schema";
import { createTestDatabase } from "@/../tests/helpers/test-database";

const expectedTables = [
  "attachments",
  "auth_throttle",
  "clarification_messages",
  "private_notes",
  "project_memberships",
  "projects",
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
  "private_notes.developer_id->users.id",
  "private_notes.request_id->requests.id",
  "project_memberships.customer_id->users.id",
  "project_memberships.project_id->projects.id",
  "public_remarks.author_id->users.id",
  "public_remarks.request_id->requests.id",
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
  });
});
