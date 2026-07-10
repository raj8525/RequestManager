import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  projectMemberships,
  projects,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import { listRequestEvents } from "@/features/requests/queries";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/../tests/helpers/test-database";

const NOW = new Date("2026-07-10T08:00:00.000Z");

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
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
  return { ...user, mustChangePassword: false };
}

function fixture() {
  const database = createTestDatabase();
  const customer = insertActor(database, "customer", "CUSTOMER");
  const developer = insertActor(database, "developer", "DEVELOPER");
  const project = database.db
    .insert(projects)
    .values({
      code: "APP",
      name: "Application",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
  database.db
    .insert(projectMemberships)
    .values({ customerId: customer.id, projectId: project.id, createdAt: NOW })
    .run();
  const request = database.db
    .insert(requests)
    .values({
      projectId: project.id,
      createdById: customer.id,
      content: "A sufficiently detailed request for event history",
      requestType: "BUG",
      priority: "NORMAL",
      progressStatus: "SCHEDULED",
      recordStatus: "ACTIVE",
      needsCustomerReply: false,
      version: 2,
      idempotencyKey: "event-history-request",
      createPayloadFingerprint: "fixture",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
  database.db
    .insert(requestEvents)
    .values([
      {
        requestId: request.id,
        actorId: customer.id,
        eventType: "REQUEST_CREATED",
        visibility: "PUBLIC",
        payload: null,
        createdAt: new Date(NOW.getTime() + 1_000),
      },
      {
        requestId: request.id,
        actorId: developer.id,
        eventType: "PROGRESS_CHANGED",
        visibility: "PUBLIC",
        payload: {
          from: "UNSCHEDULED",
          to: "SCHEDULED",
          privateNote: "must-never-leave-the-database",
        },
        createdAt: new Date(NOW.getTime() + 2_000),
      },
      {
        requestId: request.id,
        actorId: developer.id,
        eventType: "REQUEST_UPDATED",
        visibility: "DEVELOPER",
        payload: { privateNote: "developer-only-payload-secret" },
        createdAt: new Date(NOW.getTime() + 3_000),
      },
    ])
    .run();
  return { customer, database, developer, project, request };
}

describe("request event history queries", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it("returns only public events to customers and exposes only allow-listed state changes", () => {
    const ctx = fixture();
    cleanups.push(ctx.database.cleanup);

    const result = listRequestEvents(ctx.database, ctx.customer, ctx.request.id);

    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          eventType: "REQUEST_CREATED",
          actor: { id: ctx.customer.id, displayName: "customer" },
          change: null,
        },
        {
          eventType: "PROGRESS_CHANGED",
          actor: { id: ctx.developer.id, displayName: "developer" },
          change: { from: "UNSCHEDULED", to: "SCHEDULED" },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("must-never-leave");
    expect(JSON.stringify(result)).not.toContain("developer-only-payload-secret");
    expect(JSON.stringify(result)).not.toContain("payload");
  });

  it("returns developer-visible events without exposing arbitrary payload fields", () => {
    const ctx = fixture();
    cleanups.push(ctx.database.cleanup);

    const result = listRequestEvents(ctx.database, ctx.developer, ctx.request.id);

    expect(result.ok && result.data.map((event) => event.eventType)).toEqual([
      "REQUEST_CREATED",
      "PROGRESS_CHANGED",
      "REQUEST_UPDATED",
    ]);
    expect(JSON.stringify(result)).not.toContain("privateNote");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rechecks customer membership, active account and forced-password state", () => {
    const ctx = fixture();
    cleanups.push(ctx.database.cleanup);

    ctx.database.db
      .delete(projectMemberships)
      .where(eq(projectMemberships.customerId, ctx.customer.id))
      .run();
    expect(listRequestEvents(ctx.database, ctx.customer, ctx.request.id)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });

    ctx.database.db
      .insert(projectMemberships)
      .values({
        customerId: ctx.customer.id,
        projectId: ctx.project.id,
        createdAt: NOW,
      })
      .run();
    ctx.database.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, ctx.customer.id))
      .run();
    expect(listRequestEvents(ctx.database, ctx.customer, ctx.request.id)).toMatchObject({
      ok: false,
      code: "PASSWORD_CHANGE_REQUIRED",
    });

    ctx.database.db
      .update(users)
      .set({ mustChangePassword: false, isActive: false })
      .where(eq(users.id, ctx.customer.id))
      .run();
    expect(listRequestEvents(ctx.database, ctx.customer, ctx.request.id)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});
