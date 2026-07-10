import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  projectMemberships,
  projects,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import { getRequestDetail } from "@/features/requests/queries";
import {
  archiveRequest,
  changeProgress,
  createRequest,
  pauseRequest,
  restoreRequest,
  resumeRequest,
  updateOwnRequest,
} from "@/features/requests/service";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/../tests/helpers/test-database";

const NOW = new Date("2026-07-10T00:00:00.000Z");

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

function insertProject(
  database: TestDatabase,
  code: string,
  active = true,
) {
  return database.db
    .insert(projects)
    .values({
      code,
      name: `${code} project`,
      isActive: active,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
}

function assign(
  database: TestDatabase,
  customerId: number,
  projectId: number,
): void {
  database.db
    .insert(projectMemberships)
    .values({ customerId, projectId, createdAt: NOW })
    .run();
}

async function createFixtureRequest(
  database: TestDatabase,
  customer: AuthenticatedUser,
  projectId: number,
  key: string,
) {
  const result = await createRequest(database, customer, {
    projectId,
    content: "A sufficiently detailed customer request",
    requestType: "BUG",
    priority: "NORMAL",
    idempotencyKey: key,
  });
  if (!result.ok) throw new Error(`fixture creation failed: ${result.code}`);
  return result.data;
}

describe("request domain service", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function database(): TestDatabase {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    return database;
  }

  it("creates only in an assigned active project and deduplicates by creator key", async () => {
    const db = database();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const active = insertProject(db, "APP");
    const inactive = insertProject(db, "OLD", false);
    const foreign = insertProject(db, "OTHER");
    assign(db, owner.id, active.id);
    assign(db, owner.id, inactive.id);

    const input = {
      projectId: active.id,
      content: "  A sufficiently detailed customer request  ",
      requestType: "NEW_FEATURE" as const,
      priority: "IMPORTANT" as const,
      idempotencyKey: "create-once",
    };
    const first = await createRequest(db, owner, input);
    const replay = await createRequest(db, owner, input);

    expect(first).toMatchObject({
      ok: true,
      data: {
        content: "A sufficiently detailed customer request",
        createdById: owner.id,
        projectId: active.id,
        progressStatus: "UNSCHEDULED",
        recordStatus: "ACTIVE",
        version: 1,
      },
    });
    expect(replay).toMatchObject({ ok: true });
    if (!first.ok || !replay.ok) throw new Error("creation failed");
    expect(replay.data.id).toBe(first.data.id);
    expect(first.data).not.toHaveProperty("idempotencyKey");
    expect(first.data).not.toHaveProperty("privateNotes");

    await expect(
      createRequest(db, owner, { ...input, content: "A different valid request body" }),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });
    await expect(
      createRequest(db, owner, {
        ...input,
        projectId: inactive.id,
        idempotencyKey: "inactive-project",
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      createRequest(db, owner, {
        ...input,
        projectId: foreign.id,
        idempotencyKey: "foreign-project",
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      createRequest(db, developer, { ...input, idempotencyKey: "developer-create" }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      createRequest(db, owner, {
        ...input,
        content: " too short ",
        idempotencyKey: "short-content",
      }),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    expect(db.db.select().from(requests).all()).toHaveLength(1);
    expect(db.db.select().from(requestEvents).all()).toMatchObject([
      {
        requestId: first.data.id,
        actorId: owner.id,
        eventType: "REQUEST_CREATED",
        visibility: "PUBLIC",
      },
    ]);
  });

  it("lets only the owner edit active unscheduled content and rejects stale forms", async () => {
    const db = database();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const peer = insertActor(db, "peer", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    assign(db, peer.id, project.id);
    const request = await createFixtureRequest(db, owner, project.id, "edit-request");

    const edited = await updateOwnRequest(db, owner, {
      requestId: request.id,
      expectedVersion: request.version,
      content: "An updated and still detailed customer request",
      requestType: "CHANGE",
      priority: "URGENT",
    });
    expect(edited).toMatchObject({
      ok: true,
      data: { version: 2, requestType: "CHANGE", priority: "URGENT" },
    });

    await expect(
      updateOwnRequest(db, peer, {
        requestId: request.id,
        expectedVersion: 2,
        content: "Peer must not overwrite the customer request",
        requestType: "BUG",
        priority: "NORMAL",
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      updateOwnRequest(db, developer, {
        requestId: request.id,
        expectedVersion: 2,
        content: "Developer must not rewrite customer content",
        requestType: "BUG",
        priority: "NORMAL",
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });

    const scheduled = await changeProgress(db, developer, {
      requestId: request.id,
      expectedVersion: 2,
      progressStatus: "SCHEDULED",
    });
    expect(scheduled).toMatchObject({ ok: true, data: { version: 3 } });
    await expect(
      updateOwnRequest(db, owner, {
        requestId: request.id,
        expectedVersion: 2,
        content: "This stale edit must never overwrite scheduling",
        requestType: "BUG",
        priority: "NORMAL",
      }),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });

    expect(
      db.db.select().from(requests).where(eq(requests.id, request.id)).get(),
    ).toMatchObject({
      content: "An updated and still detailed customer request",
      progressStatus: "SCHEDULED",
      version: 3,
    });
  });

  it("enforces progress, pause, resume, archive and restore transitions", async () => {
    const db = database();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const peer = insertActor(db, "peer", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    assign(db, peer.id, project.id);
    const request = await createFixtureRequest(db, owner, project.id, "lifecycle");

    const scheduled = await changeProgress(db, developer, {
      requestId: request.id,
      expectedVersion: 1,
      progressStatus: "SCHEDULED",
    });
    const completed = await changeProgress(db, developer, {
      requestId: request.id,
      expectedVersion: 2,
      progressStatus: "COMPLETED",
    });
    const reopened = await changeProgress(db, developer, {
      requestId: request.id,
      expectedVersion: 3,
      progressStatus: "UNSCHEDULED",
    });
    const rescheduled = await changeProgress(db, developer, {
      requestId: request.id,
      expectedVersion: 4,
      progressStatus: "SCHEDULED",
    });
    expect([scheduled, completed, reopened, rescheduled]).toMatchObject([
      { ok: true, data: { progressStatus: "SCHEDULED", version: 2 } },
      { ok: true, data: { progressStatus: "COMPLETED", version: 3 } },
      { ok: true, data: { progressStatus: "UNSCHEDULED", version: 4 } },
      { ok: true, data: { progressStatus: "SCHEDULED", version: 5 } },
    ]);

    await expect(
      pauseRequest(db, peer, { requestId: request.id, expectedVersion: 5 }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    const paused = await pauseRequest(db, owner, {
      requestId: request.id,
      expectedVersion: 5,
    });
    expect(paused).toMatchObject({
      ok: true,
      data: { progressStatus: "SCHEDULED", recordStatus: "PAUSED", version: 6 },
    });
    await expect(
      changeProgress(db, developer, {
        requestId: request.id,
        expectedVersion: 6,
        progressStatus: "COMPLETED",
      }),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });
    await expect(
      resumeRequest(db, owner, { requestId: request.id, expectedVersion: 6 }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });

    const resumed = await resumeRequest(db, developer, {
      requestId: request.id,
      expectedVersion: 6,
    });
    const pausedByDeveloper = await pauseRequest(db, developer, {
      requestId: request.id,
      expectedVersion: 7,
    });
    const archived = await archiveRequest(db, developer, {
      requestId: request.id,
      expectedVersion: 8,
    });
    const restored = await restoreRequest(db, developer, {
      requestId: request.id,
      expectedVersion: 9,
    });
    expect([resumed, pausedByDeveloper, archived, restored]).toMatchObject([
      { ok: true, data: { recordStatus: "ACTIVE", progressStatus: "SCHEDULED" } },
      { ok: true, data: { recordStatus: "PAUSED", progressStatus: "SCHEDULED" } },
      { ok: true, data: { recordStatus: "ARCHIVED", progressStatus: "SCHEDULED" } },
      {
        ok: true,
        data: { recordStatus: "ACTIVE", progressStatus: "SCHEDULED", version: 10 },
      },
    ]);

    expect(
      db.db
        .select({ eventType: requestEvents.eventType })
        .from(requestEvents)
        .where(eq(requestEvents.requestId, request.id))
        .all()
        .map((event) => event.eventType),
    ).toEqual([
      "REQUEST_CREATED",
      "PROGRESS_CHANGED",
      "PROGRESS_CHANGED",
      "PROGRESS_CHANGED",
      "PROGRESS_CHANGED",
      "REQUEST_PAUSED",
      "REQUEST_RESUMED",
      "REQUEST_PAUSED",
      "REQUEST_ARCHIVED",
      "REQUEST_RESTORED",
    ]);
  });

  it("hides guessed request IDs and rechecks live membership and actors on writes", async () => {
    const db = database();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const outsider = insertActor(db, "outsider", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const project = insertProject(db, "APP");
    const otherProject = insertProject(db, "OTHER");
    assign(db, owner.id, project.id);
    assign(db, outsider.id, otherProject.id);
    const request = await createFixtureRequest(db, owner, project.id, "private-project");

    expect(getRequestDetail(db, outsider, request.id)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    await expect(
      updateOwnRequest(db, outsider, {
        requestId: request.id,
        expectedVersion: 1,
        content: "An outsider must not mutate a guessed request id",
        requestType: "CHANGE",
        priority: "URGENT",
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });

    db.db
      .delete(projectMemberships)
      .where(
        and(
          eq(projectMemberships.customerId, owner.id),
          eq(projectMemberships.projectId, project.id),
        ),
      )
      .run();
    await expect(
      updateOwnRequest(db, owner, {
        requestId: request.id,
        expectedVersion: 1,
        content: "Removed memberships lose access immediately",
        requestType: "CHANGE",
        priority: "NORMAL",
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });

    db.db.update(users).set({ isActive: false }).where(eq(users.id, developer.id)).run();
    await expect(
      changeProgress(db, developer, {
        requestId: request.id,
        expectedVersion: 1,
        progressStatus: "SCHEDULED",
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(db.db.select().from(requestEvents).all()).toHaveLength(1);
  });
});
