import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import { projectMemberships, projects, requests, users } from "@/db/schema";
import { getCompletionNote } from "@/features/completion-notes/queries";
import { saveCompletionNote } from "@/features/completion-notes/service";
import { changeProgress, createRequest } from "@/features/requests/service";
import { listRequestEvents } from "@/features/requests/queries";
import { pngFile } from "@/../tests/fixtures/images";
import { createTestDatabase } from "@/../tests/helpers/test-database";

describe("completion notes", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  async function fixture() {
    const database = createTestDatabase(); cleanups.push(database.cleanup);
    const root = mkdtempSync(join(tmpdir(), "request-manager-completion-note-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const paths = { uploadsPath: join(root, "uploads"), temporaryUploadsPath: join(root, "tmp") };
    const actor = (username: string, role: "CUSTOMER" | "DEVELOPER") => { const row = database.db.insert(users).values({ username, displayName: username, passwordHash: "hash", role, mustChangePassword: false }).returning().get(); return { ...row, mustChangePassword: false } as AuthenticatedUser; };
    const customer = actor("customer", "CUSTOMER"); const developer = actor("developer", "DEVELOPER");
    const project = database.db.insert(projects).values({ code: "APP", name: "App" }).returning().get(); database.db.insert(projectMemberships).values({ customerId: customer.id, projectId: project.id }).run();
    const created = await createRequest(database, customer, { projectId: project.id, title: "Completion request", content: "A detailed request for completion notes", requestType: "BUG", priority: "NORMAL", idempotencyKey: "create" }); if (!created.ok) throw new Error(created.code);
    return { database, customer, developer, request: created.data, paths };
  }

  it("completes without a note, then saves a persistent note with screenshots", async () => {
    const ctx = await fixture();
    const completed = await saveCompletionNote(ctx.database, ctx.developer, { requestId: ctx.request.id, expectedVersion: 1, content: "", retainedAttachmentIds: [], completeRequest: true }, [], ctx.paths);
    expect(completed).toMatchObject({ ok: true, data: { request: { progressStatus: "COMPLETED", version: 2 }, note: null } });
    const saved = await saveCompletionNote(ctx.database, ctx.developer, { requestId: ctx.request.id, expectedVersion: 2, content: "Released and verified", retainedAttachmentIds: [], completeRequest: false }, [pngFile("complete.png")], ctx.paths);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    expect(saved).toMatchObject({ ok: true, data: { note: { content: "Released and verified", attachments: [{ originalName: "complete.png" }] } } });
    const rolledBack = await changeProgress(ctx.database, ctx.developer, { requestId: ctx.request.id, expectedVersion: 3, progressStatus: "SCHEDULED" });
    expect(rolledBack).toMatchObject({ ok: true });
    expect(getCompletionNote(ctx.database, ctx.customer, ctx.request.id)).toMatchObject({ ok: true, data: { content: "Released and verified", attachments: [{ originalName: "complete.png" }] } });
    expect(listRequestEvents(ctx.database, ctx.customer, ctx.request.id)).toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          eventType: "PROGRESS_CHANGED",
          change: { from: "UNSCHEDULED", to: "COMPLETED" },
        }),
        expect.objectContaining({
          eventType: "REQUEST_UPDATED",
          subject: "COMPLETION_NOTE",
        }),
      ]),
    });
    expect(ctx.database.db.select().from(requests).get()?.progressStatus).toBe("SCHEDULED");
  });

  it("rejects customer writes", async () => {
    const ctx = await fixture();
    await expect(saveCompletionNote(ctx.database, ctx.customer, { requestId: ctx.request.id, expectedVersion: 1, content: "no", retainedAttachmentIds: [], completeRequest: true }, [], ctx.paths)).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
