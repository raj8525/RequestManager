import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  projectMemberships,
  projects,
  requests,
  users,
} from "@/db/schema";
import { listRequests } from "@/features/requests/queries";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/../tests/helpers/test-database";

const BASE_TIME = new Date("2026-07-10T00:00:00.000Z");

function insertActor(
  database: TestDatabase,
  username: string,
  role: "CUSTOMER" | "DEVELOPER",
): AuthenticatedUser {
  const user = database.db
    .insert(users)
    .values({
      username,
      displayName: username,
      passwordHash: "test-only-hash",
      role,
      isActive: true,
      mustChangePassword: false,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    })
    .returning()
    .get();
  return { ...user, mustChangePassword: false };
}

describe("request list ordering", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function database(): TestDatabase {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    return database;
  }

  it("sorts the complete customer result before stable SQL pagination", () => {
    const db = database();
    const customer = insertActor(db, "customer", "CUSTOMER");
    const project = db.db
      .insert(projects)
      .values({
        code: "APP",
        name: "Application",
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      })
      .returning()
      .get();
    db.db
      .insert(projectMemberships)
      .values({ customerId: customer.id, projectId: project.id })
      .run();

    const pending = db.db
      .insert(requests)
      .values({
        projectId: project.id,
        createdById: customer.id,
        content: "Old request waiting for the customer",
        requestType: "BUG",
        needsCustomerReply: true,
        idempotencyKey: "pending",
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      })
      .returning()
      .get();

    const activeIds: number[] = [];
    for (let index = 0; index < 26; index += 1) {
      const row = db.db
        .insert(requests)
        .values({
          projectId: project.id,
          createdById: customer.id,
          content: `Active request number ${index}`,
          requestType: "CHANGE",
          idempotencyKey: `active-${index}`,
          createdAt: new Date(BASE_TIME.getTime() + 60_000),
          updatedAt: new Date(BASE_TIME.getTime() + 60_000),
        })
        .returning()
        .get();
      activeIds.push(row.id);
    }

    const paused = db.db
      .insert(requests)
      .values({
        projectId: project.id,
        createdById: customer.id,
        content: "Newest paused request remains below active work",
        requestType: "NEW_FEATURE",
        progressStatus: "SCHEDULED",
        recordStatus: "PAUSED",
        idempotencyKey: "paused",
        createdAt: new Date(BASE_TIME.getTime() + 120_000),
        updatedAt: new Date(BASE_TIME.getTime() + 120_000),
      })
      .returning()
      .get();

    db.db
      .insert(requests)
      .values({
        projectId: project.id,
        createdById: customer.id,
        content: "Archived request is hidden by default",
        requestType: "BUG",
        recordStatus: "ARCHIVED",
        idempotencyKey: "archived",
        createdAt: new Date(BASE_TIME.getTime() + 180_000),
        updatedAt: new Date(BASE_TIME.getTime() + 180_000),
      })
      .run();

    const first = listRequests(db, customer, { page: 1 });
    const second = listRequests(db, customer, { page: 2 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("listing failed");

    expect(first.data.items).toHaveLength(25);
    expect(first.data.items[0]?.id).toBe(pending.id);
    expect([...first.data.items, ...second.data.items].map((item) => item.id)).toEqual([
      pending.id,
      ...activeIds.reverse(),
      paused.id,
    ]);
    expect(first.data.total).toBe(28);
    expect(first.data.items[0]).not.toHaveProperty("idempotencyKey");
    expect(first.data.items[0]).not.toHaveProperty("privateNotes");
  });

  it("applies filters before paging and uses progress, priority, then updated time by default", () => {
    const db = database();
    const customer = insertActor(db, "customer", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const project = db.db
      .insert(projects)
      .values({
        code: "WEB",
        name: "Website",
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      })
      .returning()
      .get();

    const rows = [
      { title: "Completed request", content: "Alpha searchable request", requestType: "BUG" as const, progressStatus: "COMPLETED" as const, priority: "URGENT" as const, offset: 4 },
      { title: "Unique title token", content: "Beta ordinary request", requestType: "CHANGE" as const, progressStatus: "UNSCHEDULED" as const, priority: "NORMAL" as const, offset: 3 },
      { title: "Scheduled normal", content: "Scheduled normal request", requestType: "CHANGE" as const, progressStatus: "SCHEDULED" as const, priority: "NORMAL" as const, offset: 2 },
      { title: "Scheduled urgent", content: "Scheduled urgent request", requestType: "BUG" as const, progressStatus: "SCHEDULED" as const, priority: "URGENT" as const, offset: 1 },
    ].map((value, index) =>
      db.db
        .insert(requests)
        .values({
          projectId: project.id,
          createdById: customer.id,
          title: value.title,
          content: value.content,
          requestType: value.requestType,
          progressStatus: value.progressStatus,
          priority: value.priority,
          idempotencyKey: `developer-sort-${index}`,
          createdAt: BASE_TIME,
          updatedAt: new Date(BASE_TIME.getTime() + value.offset * 60_000),
        })
        .returning()
        .get(),
    );

    const listed = listRequests(db, developer, {});
    const filtered = listRequests(db, developer, {
      search: "alpha searchable",
      requestType: "BUG",
      page: 1,
      pageSize: 1,
    });
    expect(listed.ok).toBe(true);
    expect(filtered.ok).toBe(true);
    if (!listed.ok || !filtered.ok) throw new Error("listing failed");

    expect(listed.data.items.map((item) => item.content)).toEqual([
      "Scheduled urgent request",
      "Scheduled normal request",
      "Beta ordinary request",
      "Alpha searchable request",
    ]);
    expect(filtered.data.total).toBe(1);
    expect(filtered.data.items.map((item) => item.content)).toEqual([
      "Alpha searchable request",
    ]);
    const titleFiltered = listRequests(db, developer, { search: "unique title token" });
    expect(titleFiltered).toMatchObject({
      ok: true,
      data: { total: 1, items: [{ title: "Unique title token" }] },
    });

    const oldestFirst = listRequests(db, developer, {
      sort: "updatedAt",
      direction: "asc",
    });
    expect(oldestFirst.ok).toBe(true);
    if (!oldestFirst.ok) throw new Error("listing failed");
    expect(oldestFirst.data.items.map((item) => item.id)).toEqual(
      [...rows].sort((a, b) => +a.updatedAt - +b.updatedAt).map((row) => row.id),
    );
  });
});
