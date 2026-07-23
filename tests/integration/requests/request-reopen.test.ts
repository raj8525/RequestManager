import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  clarificationMessageAttachments,
  clarificationMessages,
  completionNotes,
  projectMemberships,
  projects,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import { reopenRequestWithAttachments } from "@/features/requests/reopen-service";
import { pngFile } from "@/../tests/fixtures/images";
import { createTestDatabase } from "@/../tests/helpers/test-database";

describe("customer request reopening", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function fixture() {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    const root = mkdtempSync(join(tmpdir(), "request-manager-reopen-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const paths = {
      uploadsPath: join(root, "uploads"),
      temporaryUploadsPath: join(root, "tmp"),
    };
    const actor = (username: string, role: "CUSTOMER" | "DEVELOPER") => {
      const row = database.db
        .insert(users)
        .values({
          username,
          displayName: username,
          passwordHash: "hash",
          role,
          mustChangePassword: false,
        })
        .returning()
        .get();
      return { ...row, mustChangePassword: false } as AuthenticatedUser;
    };
    const customer = actor("customer", "CUSTOMER");
    const peer = actor("peer", "CUSTOMER");
    const developer = actor("developer", "DEVELOPER");
    const project = database.db
      .insert(projects)
      .values({ code: "APP", name: "App" })
      .returning()
      .get();
    database.db.insert(projectMemberships).values([
      { customerId: customer.id, projectId: project.id },
      { customerId: peer.id, projectId: project.id },
    ]).run();
    const request = database.db
      .insert(requests)
      .values({
        projectId: project.id,
        createdById: customer.id,
        title: "Completed request",
        content: "A completed request ready to reopen",
        requestType: "BUG",
        priority: "NORMAL",
        progressStatus: "COMPLETED",
        recordStatus: "ACTIVE",
        idempotencyKey: "create",
        createPayloadFingerprint: "fixture",
        version: 4,
      })
      .returning()
      .get();
    database.db.insert(completionNotes).values({
      requestId: request.id,
      content: "Original completion note",
      updatedById: developer.id,
    }).run();
    return { database, paths, customer, peer, developer, project, request };
  }

  it("reopens an owned completed request with a reason and screenshot", async () => {
    const ctx = fixture();
    const result = await reopenRequestWithAttachments(
      ctx.database,
      ctx.customer,
      {
        requestId: ctx.request.id,
        expectedVersion: 4,
        reason: "验收时发现原问题仍然存在",
        idempotencyKey: "reopen-once",
      },
      [pngFile("reopen.png")],
      ctx.paths,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { id: ctx.request.id, progressStatus: "UNSCHEDULED", version: 5 },
    });
    expect(
      ctx.database.db.select().from(clarificationMessages).get(),
    ).toMatchObject({
      authorId: ctx.customer.id,
      authorRole: "CUSTOMER",
      messageKind: "REOPEN_REASON",
      content: "验收时发现原问题仍然存在",
    });
    const attachment = ctx.database.db
      .select()
      .from(clarificationMessageAttachments)
      .get();
    expect(attachment?.originalName).toBe("reopen.png");
    expect(
      existsSync(
        join(
          ctx.paths.uploadsPath,
          attachment!.storageName.slice(0, 2),
          attachment!.storageName,
        ),
      ),
    ).toBe(true);
    expect(
      ctx.database.db.select().from(requestEvents).orderBy(requestEvents.id).all(),
    ).toEqual([
      expect.objectContaining({
        eventType: "PROGRESS_CHANGED",
        visibility: "PUBLIC",
        payload: { from: "COMPLETED", to: "UNSCHEDULED" },
      }),
    ]);
    expect(ctx.database.db.select().from(completionNotes).get()?.content).toBe(
      "Original completion note",
    );
  });

  it("replays the same payload without duplicate rows and rejects a changed payload", async () => {
    const ctx = fixture();
    const input = {
      requestId: ctx.request.id,
      expectedVersion: 4,
      reason: "仍然可以复现",
      idempotencyKey: "stable-key",
    };
    const first = await reopenRequestWithAttachments(
      ctx.database,
      ctx.customer,
      input,
      [],
      ctx.paths,
    );
    const replay = await reopenRequestWithAttachments(
      ctx.database,
      ctx.customer,
      input,
      [],
      ctx.paths,
    );
    const conflict = await reopenRequestWithAttachments(
      ctx.database,
      ctx.customer,
      { ...input, reason: "不同原因" },
      [],
      ctx.paths,
    );

    expect(first).toMatchObject({ ok: true });
    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(ctx.database.db.select().from(clarificationMessages).all()).toHaveLength(1);
    expect(ctx.database.db.select().from(requestEvents).all()).toHaveLength(1);
  });

  it("requires a reason and enforces ownership, role, project, state and version", async () => {
    const cases = [
      { actor: "customer", input: { reason: "  " }, code: "INVALID_INPUT" },
      { actor: "peer", input: { reason: "not mine" }, code: "NOT_FOUND" },
      { actor: "developer", input: { reason: "admin" }, code: "FORBIDDEN" },
      { actor: "customer", input: { reason: "stale", expectedVersion: 3 }, code: "CONFLICT" },
    ] as const;
    for (const item of cases) {
      const ctx = fixture();
      const result = await reopenRequestWithAttachments(
        ctx.database,
        ctx[item.actor],
        {
          requestId: ctx.request.id,
          expectedVersion:
            "expectedVersion" in item.input ? item.input.expectedVersion : 4,
          reason: item.input.reason,
          idempotencyKey: `case-${item.code}`,
        },
        [],
        ctx.paths,
      );
      expect(result).toMatchObject({ ok: false, code: item.code });
      expect(
        ctx.database.db.select().from(requests).where(eq(requests.id, ctx.request.id)).get(),
      ).toMatchObject({ progressStatus: "COMPLETED", version: 4 });
    }

    const inactive = fixture();
    inactive.database.db
      .update(projects)
      .set({ isActive: false })
      .where(eq(projects.id, inactive.project.id))
      .run();
    await expect(
      reopenRequestWithAttachments(
        inactive.database,
        inactive.customer,
        {
          requestId: inactive.request.id,
          expectedVersion: 4,
          reason: "inactive",
          idempotencyKey: "inactive",
        },
        [],
        inactive.paths,
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });

    const scheduled = fixture();
    scheduled.database.db
      .update(requests)
      .set({ progressStatus: "SCHEDULED" })
      .where(eq(requests.id, scheduled.request.id))
      .run();
    await expect(
      reopenRequestWithAttachments(
        scheduled.database,
        scheduled.customer,
        {
          requestId: scheduled.request.id,
          expectedVersion: 4,
          reason: "not completed",
          idempotencyKey: "scheduled",
        },
        [],
        scheduled.paths,
      ),
    ).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
  });
});
