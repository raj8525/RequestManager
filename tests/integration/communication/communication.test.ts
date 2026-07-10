import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  clarificationMessages,
  privateNotes,
  projectMemberships,
  projects,
  publicRemarks,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import {
  getOwnPrivateNote,
  listClarificationMessages,
  listPublicRemarks,
} from "@/features/communication/queries";
import {
  addPublicRemark,
  askClarification,
  replyToClarification,
  saveOwnPrivateNote,
} from "@/features/communication/service";
import { getRequestDetail } from "@/features/requests/queries";
import {
  archiveRequest,
  changeProgress,
  createRequest,
  pauseRequest,
  restoreRequest,
  resumeRequest,
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

function assign(database: TestDatabase, customerId: number, projectId: number) {
  database.db
    .insert(projectMemberships)
    .values({ customerId, projectId, createdAt: NOW })
    .run();
}

type Fixture = ReturnType<typeof fixture>;

async function fixture() {
  const database = createTestDatabase();
  const owner = insertActor(database, "owner", "CUSTOMER");
  const projectCustomer = insertActor(database, "project-customer", "CUSTOMER");
  const outsider = insertActor(database, "outsider", "CUSTOMER");
  const developerA = insertActor(database, "developer-a", "DEVELOPER");
  const developerB = insertActor(database, "developer-b", "DEVELOPER");
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
  const otherProject = database.db
    .insert(projects)
    .values({
      code: "OTHER",
      name: "Other",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
  assign(database, owner.id, project.id);
  assign(database, projectCustomer.id, project.id);
  assign(database, outsider.id, otherProject.id);

  const created = await createRequest(database, owner, {
    projectId: project.id,
    content: "A sufficiently detailed request for communication tests",
    requestType: "BUG",
    priority: "NORMAL",
    idempotencyKey: "fixture-request",
  });
  if (!created.ok) throw new Error(`fixture creation failed: ${created.code}`);
  return {
    database,
    owner,
    projectCustomer,
    outsider,
    developerA,
    developerB,
    project,
    request: created.data,
  };
}

function currentRequest(context: Awaited<Fixture>) {
  const request = context.database.db
    .select()
    .from(requests)
    .where(eq(requests.id, context.request.id))
    .get();
  if (!request) throw new Error("fixture request disappeared");
  return request;
}

async function makeCommunicationUnavailable(
  context: Awaited<Fixture>,
  recordStatus: "PAUSED" | "ARCHIVED",
) {
  const current = currentRequest(context);
  if (recordStatus === "ARCHIVED") {
    const archived = await archiveRequest(context.database, context.developerA, {
      requestId: current.id,
      expectedVersion: current.version,
    });
    if (!archived.ok) throw new Error(`archive failed: ${archived.code}`);
  } else {
    const scheduled = await changeProgress(
      context.database,
      context.developerA,
      {
        requestId: current.id,
        expectedVersion: current.version,
        progressStatus: "SCHEDULED",
      },
    );
    if (!scheduled.ok) throw new Error(`schedule failed: ${scheduled.code}`);
    const paused = await pauseRequest(context.database, context.developerA, {
      requestId: current.id,
      expectedVersion: scheduled.data.version,
    });
    if (!paused.ok) throw new Error(`pause failed: ${paused.code}`);
  }
  expect(currentRequest(context).recordStatus).toBe(recordStatus);
}

describe("request communication", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  async function context() {
    const value = await fixture();
    cleanups.push(value.database.cleanup);
    return value;
  }

  it("keeps developer public remarks visible to customers without clearing pending", async () => {
    const ctx = await context();
    const initialRemark = {
      requestId: ctx.request.id,
      expectedVersion: ctx.request.version,
      content: "<b>Investigation has started</b>",
      idempotencyKey: "public-remark-once",
    };
    const first = await addPublicRemark(
      ctx.database,
      ctx.developerA,
      initialRemark,
    );
    const replay = await addPublicRemark(
      ctx.database,
      ctx.developerA,
      initialRemark,
    );
    await expect(
      addPublicRemark(ctx.database, ctx.developerA, {
        ...initialRemark,
        content: "The same key cannot identify different content.",
      }),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });

    expect(first).toMatchObject({
      ok: true,
      data: {
        content: "<b>Investigation has started</b>",
        author: { id: ctx.developerA.id },
      },
    });
    expect(replay).toMatchObject({ ok: true });
    if (!first.ok || !replay.ok) throw new Error("remark write failed");
    expect(replay.data.id).toBe(first.data.id);
    expect(currentRequest(ctx)).toMatchObject({
      needsCustomerReply: false,
      version: 2,
    });

    const asked = await askClarification(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 2,
      content: "Which browser version reproduces this problem?",
      idempotencyKey: "question-before-remark",
    });
    expect(asked).toMatchObject({ ok: true });
    await addPublicRemark(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 3,
      content: "Investigation continues while waiting for the customer.",
      idempotencyKey: "public-remark-while-pending",
    });
    expect(currentRequest(ctx)).toMatchObject({
      needsCustomerReply: true,
      version: 4,
    });
    expect(ctx.database.db.select().from(publicRemarks).all()).toHaveLength(2);

    expect(listPublicRemarks(ctx.database, ctx.owner, ctx.request.id)).toMatchObject({
      ok: true,
      data: [
        { content: "<b>Investigation has started</b>" },
        { content: "Investigation continues while waiting for the customer." },
      ],
    });
    await expect(
      addPublicRemark(ctx.database, ctx.owner, {
        requestId: ctx.request.id,
        expectedVersion: currentRequest(ctx).version,
        content: "Customers cannot add public remarks",
        idempotencyKey: "customer-public-remark",
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("keeps one private note per request and developer out of every shared payload", async () => {
    const ctx = await context();
    const secret = "developer A private diagnosis";
    const first = await saveOwnPrivateNote(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: ctx.request.version,
      content: secret,
    });
    const updated = await saveOwnPrivateNote(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: ctx.request.version,
      content: `${secret}, updated`,
    });

    expect(first).toMatchObject({ ok: true, data: { content: secret } });
    expect(updated).toMatchObject({
      ok: true,
      data: { content: `${secret}, updated` },
    });
    expect(ctx.database.db.select().from(privateNotes).all()).toHaveLength(1);
    expect(
      getOwnPrivateNote(ctx.database, ctx.developerA, ctx.request.id),
    ).toMatchObject({ ok: true, data: { content: `${secret}, updated` } });
    expect(
      getOwnPrivateNote(ctx.database, ctx.developerB, ctx.request.id),
    ).toEqual({ ok: true, data: null });
    expect(getOwnPrivateNote(ctx.database, ctx.owner, ctx.request.id)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });

    const sharedPayloads = [
      getRequestDetail(ctx.database, ctx.owner, ctx.request.id),
      listPublicRemarks(ctx.database, ctx.owner, ctx.request.id),
      listClarificationMessages(ctx.database, ctx.owner, ctx.request.id),
      ctx.database.db.select().from(requestEvents).all(),
    ];
    expect(JSON.stringify(sharedPayloads)).not.toContain(secret);
    expect(
      ctx.database.db
        .select()
        .from(requestEvents)
        .where(eq(requestEvents.requestId, ctx.request.id))
        .all(),
    ).toHaveLength(1);
  });

  it("atomically clears pending on the first current-project customer reply", async () => {
    const ctx = await context();
    const question = {
      requestId: ctx.request.id,
      expectedVersion: ctx.request.version,
      content: "Can you provide the exact steps to reproduce?",
      idempotencyKey: "clarification-question",
    };
    const asked = await askClarification(ctx.database, ctx.developerA, question);
    const replay = await askClarification(ctx.database, ctx.developerA, question);
    expect(asked).toMatchObject({ ok: true });
    expect(replay).toMatchObject({ ok: true });
    if (!asked.ok || !replay.ok) throw new Error("question write failed");
    expect(replay.data.id).toBe(asked.data.id);
    expect(currentRequest(ctx)).toMatchObject({ needsCustomerReply: true, version: 2 });
    expect(ctx.database.db.select().from(clarificationMessages).all()).toHaveLength(1);

    const firstReply = await replyToClarification(
      ctx.database,
      ctx.projectCustomer,
      {
        requestId: ctx.request.id,
        expectedVersion: 2,
        content: "It reproduces after signing in and opening the dashboard.",
        idempotencyKey: "first-customer-reply",
      },
    );
    expect(firstReply).toMatchObject({ ok: true });
    expect(currentRequest(ctx)).toMatchObject({ needsCustomerReply: false, version: 3 });

    const replayAfterReply = await askClarification(
      ctx.database,
      ctx.developerA,
      question,
    );
    expect(replayAfterReply).toMatchObject({ ok: true });
    expect(currentRequest(ctx)).toMatchObject({ needsCustomerReply: false, version: 3 });

    await expect(
      replyToClarification(ctx.database, ctx.owner, {
        requestId: ctx.request.id,
        expectedVersion: 2,
        content: "A stale second reply must not be appended.",
        idempotencyKey: "stale-second-reply",
      }),
    ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    await expect(
      replyToClarification(ctx.database, ctx.outsider, {
        requestId: ctx.request.id,
        expectedVersion: 3,
        content: "An outsider must not reply to a guessed request.",
        idempotencyKey: "outsider-reply",
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });

    expect(ctx.database.db.select().from(clarificationMessages).all()).toHaveLength(2);
    expect(
      listClarificationMessages(ctx.database, ctx.owner, ctx.request.id),
    ).toMatchObject({
      ok: true,
      data: [
        { authorRole: "DEVELOPER" },
        { authorRole: "CUSTOMER" },
      ],
    });
  });

  describe.each(["PAUSED", "ARCHIVED"] as const)(
    "idempotent replay after a request becomes %s",
    (recordStatus) => {
      it("rejects an existing public remark key", async () => {
        const ctx = await context();
        const input = {
          requestId: ctx.request.id,
          expectedVersion: ctx.request.version,
          content: "This public remark was created while the request was active.",
          idempotencyKey: `remark-before-${recordStatus}`,
        };
        await expect(
          addPublicRemark(ctx.database, ctx.developerA, input),
        ).resolves.toMatchObject({ ok: true });

        await makeCommunicationUnavailable(ctx, recordStatus);

        await expect(
          addPublicRemark(ctx.database, ctx.developerA, input),
        ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
      });

      it("rejects an existing clarification question key", async () => {
        const ctx = await context();
        const input = {
          requestId: ctx.request.id,
          expectedVersion: ctx.request.version,
          content: "This clarification was asked while the request was active.",
          idempotencyKey: `question-before-${recordStatus}`,
        };
        await expect(
          askClarification(ctx.database, ctx.developerA, input),
        ).resolves.toMatchObject({ ok: true });

        await makeCommunicationUnavailable(ctx, recordStatus);

        await expect(
          askClarification(ctx.database, ctx.developerA, input),
        ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
      });

      it("rejects an existing clarification reply key", async () => {
        const ctx = await context();
        const asked = await askClarification(ctx.database, ctx.developerA, {
          requestId: ctx.request.id,
          expectedVersion: ctx.request.version,
          content: "Please confirm this before the request becomes unavailable.",
          idempotencyKey: `question-for-reply-before-${recordStatus}`,
        });
        if (!asked.ok) throw new Error(`question failed: ${asked.code}`);
        const input = {
          requestId: ctx.request.id,
          expectedVersion: currentRequest(ctx).version,
          content: "This reply was submitted while the request was active.",
          idempotencyKey: `reply-before-${recordStatus}`,
        };
        await expect(
          replyToClarification(ctx.database, ctx.owner, input),
        ).resolves.toMatchObject({ ok: true });

        await makeCommunicationUnavailable(ctx, recordStatus);

        await expect(
          replyToClarification(ctx.database, ctx.owner, input),
        ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
      });
    },
  );

  it("rejects writes while paused or archived and recomputes pending on resume and restore", async () => {
    const ctx = await context();
    await askClarification(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 1,
      content: "Please confirm whether this also happens on mobile.",
      idempotencyKey: "question-before-pause",
    });
    await changeProgress(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 2,
      progressStatus: "SCHEDULED",
    });
    await pauseRequest(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 3,
    });

    expect(getRequestDetail(ctx.database, ctx.owner, ctx.request.id)).toMatchObject({
      ok: true,
      data: { recordStatus: "PAUSED", needsCustomerReply: false },
    });
    await expect(
      addPublicRemark(ctx.database, ctx.developerA, {
        requestId: ctx.request.id,
        expectedVersion: 4,
        content: "Paused requests reject public remarks.",
        idempotencyKey: "paused-public-remark",
      }),
    ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    await expect(
      saveOwnPrivateNote(ctx.database, ctx.developerA, {
        requestId: ctx.request.id,
        expectedVersion: 4,
        content: "Paused requests reject private-note edits.",
      }),
    ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    await expect(
      replyToClarification(ctx.database, ctx.owner, {
        requestId: ctx.request.id,
        expectedVersion: 4,
        content: "Paused requests reject clarification replies.",
        idempotencyKey: "paused-reply",
      }),
    ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });

    await resumeRequest(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 4,
    });
    expect(currentRequest(ctx)).toMatchObject({
      recordStatus: "ACTIVE",
      needsCustomerReply: true,
      version: 5,
    });
    await replyToClarification(ctx.database, ctx.owner, {
      requestId: ctx.request.id,
      expectedVersion: 5,
      content: "It does not reproduce on mobile.",
      idempotencyKey: "reply-before-archive",
    });
    await archiveRequest(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 6,
    });
    await restoreRequest(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 7,
    });
    expect(currentRequest(ctx)).toMatchObject({
      recordStatus: "ACTIVE",
      needsCustomerReply: false,
      version: 8,
    });

    await askClarification(ctx.database, ctx.developerB, {
      requestId: ctx.request.id,
      expectedVersion: 8,
      content: "Could you attach the console error text?",
      idempotencyKey: "question-before-archive",
    });
    await archiveRequest(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 9,
    });
    expect(getRequestDetail(ctx.database, ctx.owner, ctx.request.id)).toMatchObject({
      ok: true,
      data: { recordStatus: "ARCHIVED", needsCustomerReply: false },
    });
    await expect(
      askClarification(ctx.database, ctx.developerA, {
        requestId: ctx.request.id,
        expectedVersion: 10,
        content: "Archived requests reject new questions.",
        idempotencyKey: "archived-question",
      }),
    ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    await restoreRequest(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 10,
    });
    expect(currentRequest(ctx)).toMatchObject({
      recordStatus: "ACTIVE",
      needsCustomerReply: true,
      version: 11,
    });
  });

  it("rechecks expected versions, live actors and current memberships", async () => {
    const ctx = await context();
    await askClarification(ctx.database, ctx.developerA, {
      requestId: ctx.request.id,
      expectedVersion: 1,
      content: "This question advances the request version.",
      idempotencyKey: "advance-version",
    });
    await expect(
      addPublicRemark(ctx.database, ctx.developerB, {
        requestId: ctx.request.id,
        expectedVersion: 1,
        content: "A stale public remark must be rejected.",
        idempotencyKey: "stale-public-remark",
      }),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });

    ctx.database.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, ctx.developerB.id))
      .run();
    await expect(
      saveOwnPrivateNote(ctx.database, ctx.developerB, {
        requestId: ctx.request.id,
        expectedVersion: 2,
        content: "A disabled developer cannot save a note.",
      }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });

    ctx.database.db
      .delete(projectMemberships)
      .where(
        and(
          eq(projectMemberships.customerId, ctx.owner.id),
          eq(projectMemberships.projectId, ctx.project.id),
        ),
      )
      .run();
    await expect(
      replyToClarification(ctx.database, ctx.owner, {
        requestId: ctx.request.id,
        expectedVersion: 2,
        content: "A removed project member cannot reply.",
        idempotencyKey: "removed-member-reply",
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
