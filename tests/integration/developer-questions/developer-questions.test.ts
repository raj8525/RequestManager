import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  developerQuestions,
  projectMemberships,
  projects,
  users,
} from "@/db/schema";
import {
  appendDeveloperQuestionMessage,
  createDeveloperQuestion,
  markDeveloperQuestionSeen,
} from "@/features/developer-questions/service";
import {
  getDeveloperQuestionDetail,
  listDeveloperQuestionMessages,
} from "@/features/developer-questions/queries";
import { createTestDatabase, type TestDatabase } from "@/../tests/helpers/test-database";

function actor(db: TestDatabase, username: string, role: "CUSTOMER" | "DEVELOPER"): AuthenticatedUser {
  const row = db.db.insert(users).values({ username, displayName: username, passwordHash: "hash", role, mustChangePassword: false }).returning().get();
  return { ...row, mustChangePassword: false };
}

describe("developer questions", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it("moves attention between customers and developers", async () => {
    const db = createTestDatabase();
    cleanups.push(db.cleanup);
    const developer = actor(db, "developer", "DEVELOPER");
    const customer = actor(db, "customer", "CUSTOMER");
    const project = db.db.insert(projects).values({ code: "APP", name: "App" }).returning().get();
    db.db.insert(projectMemberships).values({ customerId: customer.id, projectId: project.id }).run();

    const created = await createDeveloperQuestion(db, developer, {
      projectId: project.id,
      content: "请确认这个页面的设计方向",
      idempotencyKey: "create-question",
    }, [], { uploadsPath: "/tmp/unused", temporaryUploadsPath: "/tmp/unused-temp" });
    expect(created).toMatchObject({ ok: true, data: { attentionStatus: "WAITING_CUSTOMER", version: 1 } });
    if (!created.ok) throw new Error("creation failed");

    const reply = await appendDeveloperQuestionMessage(db, customer, {
      questionId: created.data.id,
      expectedVersion: 1,
      content: "客户认可这个方向，并补充一个建议。",
      idempotencyKey: "customer-reply",
    }, [], { uploadsPath: "/tmp/unused", temporaryUploadsPath: "/tmp/unused-temp" });
    expect(reply).toMatchObject({ ok: true, data: { question: { attentionStatus: "WAITING_DEVELOPER", version: 2 } } });

    const seen = await markDeveloperQuestionSeen(db, developer, {
      questionId: created.data.id,
      expectedVersion: 2,
    });
    expect(seen).toMatchObject({ ok: true, data: { attentionStatus: "SEEN", version: 3 } });

    const followUp = await appendDeveloperQuestionMessage(db, developer, {
      questionId: created.data.id,
      expectedVersion: 3,
      content: "我已经调整设计，请客户再次确认。",
      idempotencyKey: "developer-follow-up",
    }, [], { uploadsPath: "/tmp/unused", temporaryUploadsPath: "/tmp/unused-temp" });
    expect(followUp).toMatchObject({ ok: true, data: { question: { attentionStatus: "WAITING_CUSTOMER", version: 4 } } });
    expect(getDeveloperQuestionDetail(db, customer, created.data.id)).toMatchObject({
      ok: true,
      data: { questionNumber: "ASK-000001", project: { code: "APP" } },
    });
    expect(listDeveloperQuestionMessages(db, customer, created.data.id)).toMatchObject({
      ok: true,
      data: [
        { authorRole: "CUSTOMER", content: "客户认可这个方向，并补充一个建议。" },
        { authorRole: "DEVELOPER", content: "我已经调整设计，请客户再次确认。" },
      ],
    });
  });

  it("rejects non-members and stopped projects", async () => {
    const db = createTestDatabase();
    cleanups.push(db.cleanup);
    const developer = actor(db, "developer", "DEVELOPER");
    const outsider = actor(db, "outsider", "CUSTOMER");
    const project = db.db.insert(projects).values({ code: "APP", name: "App" }).returning().get();
    const created = await createDeveloperQuestion(db, developer, { projectId: project.id, content: "需要客户确认的问题", idempotencyKey: "q" }, [], { uploadsPath: "/tmp/u", temporaryUploadsPath: "/tmp/t" });
    if (!created.ok) throw new Error("creation failed");

    await expect(appendDeveloperQuestionMessage(db, outsider, { questionId: created.data.id, expectedVersion: 1, content: "越权回复", idempotencyKey: "x" }, [], { uploadsPath: "/tmp/u", temporaryUploadsPath: "/tmp/t" })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    db.db.update(projects).set({ isActive: false }).where(eq(projects.id, project.id)).run();
    await expect(appendDeveloperQuestionMessage(db, developer, { questionId: created.data.id, expectedVersion: 1, content: "停用后追问", idempotencyKey: "stopped" }, [], { uploadsPath: "/tmp/u", temporaryUploadsPath: "/tmp/t" })).resolves.toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(db.db.select().from(developerQuestions).get()?.version).toBe(1);
  });
});
