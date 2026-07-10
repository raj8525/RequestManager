import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const passwordMocks = vi.hoisted(() => ({
  hashPassword: vi.fn<(password: string) => Promise<string>>(),
  verifyPassword: vi.fn<(password: string, encoded: string) => Promise<boolean>>(),
}));

vi.mock("@/auth/password", () => passwordMocks);

import { changeOwnPasswordAction, type AuthActionContext } from "@/auth/actions";
import { createSession } from "@/auth/session-service";
import { sessions, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/../tests/helpers/test-database";

const NOW = new Date("2026-07-10T00:00:00.000Z");

class TestCookies {
  readonly values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }
  set(name: string, value: string) {
    this.values.set(name, value);
  }
}

describe("own password change concurrency", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
  beforeEach(() => vi.clearAllMocks());

  function database() {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    return database;
  }

  it("does not overwrite an administrator reset completed during scrypt", async () => {
    const db: TestDatabase = database();
    const user = db.db
      .insert(users)
      .values({
        username: "alice",
        displayName: "Alice",
        passwordHash: "original-hash",
        role: "CUSTOMER",
        isActive: true,
        mustChangePassword: false,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning()
      .get();
    const session = createSession(db, user.id, NOW);
    const cookies = new TestCookies();
    cookies.values.set("request_manager_session", session.token);
    passwordMocks.verifyPassword.mockResolvedValue(true);
    let releaseHash!: (value: string) => void;
    passwordMocks.hashPassword.mockImplementation(
      () => new Promise((resolve) => (releaseHash = resolve)),
    );
    const context: AuthActionContext = {
      appOrigin: "https://requests.example.test",
      cookies,
      headers: new Headers({
        host: "requests.example.test",
        origin: "https://requests.example.test",
      }),
      now: NOW,
      secureCookies: true,
      source: "203.0.113.10",
      redirect: vi.fn(),
    };

    const changing = changeOwnPasswordAction(
      db,
      { oldPassword: "original password", newPassword: "user chosen password" },
      context,
    );
    await vi.waitFor(() => expect(passwordMocks.hashPassword).toHaveBeenCalledOnce());

    db.sqlite.transaction(() => {
      db.db
        .update(users)
        .set({ passwordHash: "administrator-reset-hash", mustChangePassword: true })
        .where(eq(users.id, user.id))
        .run();
      db.db.delete(sessions).where(eq(sessions.userId, user.id)).run();
    })();
    releaseHash("user-chosen-hash");

    await expect(changing).resolves.toMatchObject({
      ok: false,
      code: "CONFLICT",
      message: "账号状态已变化，请重新登录后再试",
    });
    expect(db.db.select().from(users).where(eq(users.id, user.id)).get()).toMatchObject({
      passwordHash: "administrator-reset-hash",
      mustChangePassword: true,
    });
  });
});
