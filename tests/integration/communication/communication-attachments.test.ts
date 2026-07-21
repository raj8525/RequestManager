import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  clarificationMessageAttachments,
  projectMemberships,
  projects,
  publicRemarkAttachments,
  requests,
  users,
} from "@/db/schema";
import {
  addPublicRemarkWithAttachments,
  appendClarificationWithAttachments,
} from "@/features/communication/attachment-service";
import { listClarificationMessages, listPublicRemarks } from "@/features/communication/queries";
import { createRequest } from "@/features/requests/service";
import { pngFile } from "@/../tests/fixtures/images";
import { createTestDatabase } from "@/../tests/helpers/test-database";

describe("communication screenshots", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  async function fixture() {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    const root = mkdtempSync(join(tmpdir(), "request-manager-communication-images-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const paths = { uploadsPath: join(root, "uploads"), temporaryUploadsPath: join(root, "tmp") };
    const actor = (username: string, role: "CUSTOMER" | "DEVELOPER") => {
      const row = database.db.insert(users).values({ username, displayName: username, passwordHash: "hash", role, mustChangePassword: false }).returning().get();
      return { ...row, mustChangePassword: false } as AuthenticatedUser;
    };
    const customer = actor("customer", "CUSTOMER");
    const developer = actor("developer", "DEVELOPER");
    const project = database.db.insert(projects).values({ code: "APP", name: "App" }).returning().get();
    database.db.insert(projectMemberships).values({ customerId: customer.id, projectId: project.id }).run();
    const created = await createRequest(database, customer, { projectId: project.id, title: "Screenshot request", content: "A detailed request for screenshot communication", requestType: "BUG", priority: "NORMAL", idempotencyKey: "create" });
    if (!created.ok) throw new Error(created.code);
    return { database, customer, developer, request: created.data, paths };
  }

  it("stores and exposes screenshots for public remarks and both clarification roles", async () => {
    const ctx = await fixture();
    const remark = await addPublicRemarkWithAttachments(ctx.database, ctx.developer, {
      requestId: ctx.request.id, expectedVersion: 1, content: "Please review this screenshot", idempotencyKey: "remark",
    }, [pngFile("remark.png")], ctx.paths);
    expect(remark).toMatchObject({ ok: true, data: { attachments: [{ originalName: "remark.png" }] } });

    const asked = await appendClarificationWithAttachments(ctx.database, ctx.developer, {
      requestId: ctx.request.id, expectedVersion: 2, content: "Does this match your result?", idempotencyKey: "ask",
    }, [pngFile("ask.png")], ctx.paths);
    expect(asked).toMatchObject({ ok: true, data: { attachments: [{ originalName: "ask.png" }] } });
    const replied = await appendClarificationWithAttachments(ctx.database, ctx.customer, {
      requestId: ctx.request.id, expectedVersion: 3, content: "Yes, this is the same result", idempotencyKey: "reply",
    }, [pngFile("reply.png")], ctx.paths);
    expect(replied).toMatchObject({ ok: true, data: { attachments: [{ originalName: "reply.png" }] } });

    expect(listPublicRemarks(ctx.database, ctx.customer, ctx.request.id)).toMatchObject({ ok: true, data: [{ attachments: [{ originalName: "remark.png" }] }] });
    expect(listClarificationMessages(ctx.database, ctx.customer, ctx.request.id)).toMatchObject({ ok: true, data: [{ attachments: [{ originalName: "ask.png" }] }, { attachments: [{ originalName: "reply.png" }] }] });
    const rows = [...ctx.database.db.select().from(publicRemarkAttachments).all(), ...ctx.database.db.select().from(clarificationMessageAttachments).all()];
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => existsSync(join(ctx.paths.uploadsPath, row.storageName.slice(0, 2), row.storageName)))).toBe(true);
    expect(ctx.database.db.select().from(requests).where(eq(requests.id, ctx.request.id)).get()?.version).toBe(4);
  });
});
