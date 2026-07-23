import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERIC_LOGIN_ERROR,
  changeOwnPasswordAction,
  loginAction,
  logoutAction,
  type AuthActionContext,
} from "@/auth/actions";
import {
  AuthorizationError,
  canAccessProject,
  requireCustomer,
  requireDeveloper,
} from "@/auth/authorization";
import { hashPassword, verifyPassword } from "@/auth/password";
import {
  createSession,
  getSessionUser,
  revokeUserSessions,
} from "@/auth/session-service";
import {
  LOGIN_SOURCE_ATTEMPT_LIMIT,
  LOGIN_THROTTLE_MAX_ROWS,
  LOGIN_THROTTLE_SOURCE_KEY,
  isLoginThrottled,
  reserveLoginAttempt,
} from "@/auth/throttle";
import {
  authThrottle,
  projectMemberships,
  projects,
  sessions,
  users,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/../tests/helpers/test-database";

const NOW = new Date("2026-07-10T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

class TestCookies {
  readonly values = new Map<string, string>();
  readonly writes: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];

  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }

  set(name: string, value: string, options: Record<string, unknown>) {
    this.values.set(name, value);
    this.writes.push({ name, value, options });
  }
}

function actionContext(
  cookies = new TestCookies(),
  overrides: Partial<AuthActionContext> = {},
): AuthActionContext {
  return {
    appOrigin: "https://requests.example.test",
    cookies,
    headers: new Headers({
      host: "requests.example.test",
      origin: "https://requests.example.test",
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-proto": "https",
    }),
    now: NOW,
    secureCookies: true,
    ...overrides,
  };
}

function forwardedActionContext(
  source: string,
  trustProxyHeaders?: boolean,
): AuthActionContext {
  return actionContext(new TestCookies(), {
    headers: new Headers({
      host: "requests.example.test",
      origin: "https://requests.example.test",
      "x-forwarded-for": source,
      "x-forwarded-proto": "https",
    }),
    trustProxyHeaders,
  });
}

async function insertUser(
  db: TestDatabase,
  input: {
    username?: string;
    role?: "CUSTOMER" | "DEVELOPER";
    isActive?: boolean;
    mustChangePassword?: boolean;
    password?: string;
  } = {},
) {
  const passwordHash = await hashPassword(input.password ?? "initial password");
  return db.db
    .insert(users)
    .values({
      username: input.username ?? "alice",
      displayName: "Alice",
      passwordHash,
      role: input.role ?? "CUSTOMER",
      isActive: input.isActive ?? true,
      mustChangePassword: input.mustChangePassword ?? true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
}

describe("database-backed sessions", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.unstubAllEnvs();
  });

  function database() {
    const db = createTestDatabase();
    cleanups.push(db.cleanup);
    return db;
  }

  it("stores only a SHA-256 token digest and expires after seven days", async () => {
    const db = database();
    const user = await insertUser(db);

    const created = createSession(db, user.id, NOW);
    const stored = db.db.select().from(sessions).get();

    expect(Buffer.from(created.token, "base64url")).toHaveLength(32);
    expect(created.expiresAt).toEqual(new Date(NOW.getTime() + 7 * DAY_MS));
    expect(stored?.tokenHash).toBe(
      createHash("sha256").update(created.token).digest("hex"),
    );
    expect(stored?.tokenHash).not.toContain(created.token);
    expect(getSessionUser(db, created.token, NOW)).toMatchObject({
      id: user.id,
      username: "alice",
      role: "CUSTOMER",
      mustChangePassword: true,
    });
  });

  it("rejects a session immediately after the user is disabled", async () => {
    const db = database();
    const user = await insertUser(db);
    const { token } = createSession(db, user.id, NOW);

    db.db.update(users).set({ isActive: false }).where(eq(users.id, user.id)).run();

    expect(getSessionUser(db, token, NOW)).toBeNull();
  });

  it("rejects expired sessions and revokes every session for a user", async () => {
    const db = database();
    const user = await insertUser(db);
    const first = createSession(db, user.id, NOW);
    const second = createSession(db, user.id, NOW);

    expect(getSessionUser(db, first.token, first.expiresAt)).toBeNull();
    revokeUserSessions(db, user.id);
    expect(getSessionUser(db, first.token, NOW)).toBeNull();
    expect(getSessionUser(db, second.token, NOW)).toBeNull();
  });

  it("enforces role guards and current project membership", async () => {
    const db = database();
    const customer = await insertUser(db, { mustChangePassword: false });
    const developer = await insertUser(db, {
      username: "dev",
      role: "DEVELOPER",
      mustChangePassword: false,
    });
    const projectId = db.db
      .insert(projects)
      .values({ code: "APP", name: "App", isActive: false })
      .returning({ id: projects.id })
      .get().id;
    db.db
      .insert(projectMemberships)
      .values({ customerId: customer.id, projectId })
      .run();
    const customerActor = getSessionUser(
      db,
      createSession(db, customer.id, NOW).token,
      NOW,
    );
    const developerActor = getSessionUser(
      db,
      createSession(db, developer.id, NOW).token,
      NOW,
    );

    expect(requireCustomer(customerActor).id).toBe(customer.id);
    expect(() => requireDeveloper(customerActor)).toThrow(AuthorizationError);
    expect(requireDeveloper(developerActor).id).toBe(developer.id);
    expect(canAccessProject(db, customerActor!, projectId)).toBe(true);
    db.db
      .delete(projectMemberships)
      .where(eq(projectMemberships.customerId, customer.id))
      .run();
    expect(canAccessProject(db, customerActor!, projectId)).toBe(false);
    expect(canAccessProject(db, developerActor!, projectId)).toBe(true);
    expect(canAccessProject(db, developerActor!, 999_999)).toBe(false);
  });

  it("persists a five-failure throttle for fifteen minutes", () => {
    const db = database();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        reserveLoginAttempt(db, " Alice ", "203.0.113.10", NOW),
      ).toBe(true);
    }

    expect(isLoginThrottled(db, "ALICE", "203.0.113.10", NOW)).toBe(true);
    expect(
      reserveLoginAttempt(db, "ALICE", "203.0.113.10", NOW),
    ).toBe(false);
    expect(
      db.db
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.normalizedUsername, "alice"))
        .get(),
    ).toMatchObject({
      normalizedUsername: "alice",
      failureCount: 5,
    });
    expect(
      isLoginThrottled(
        db,
        "alice",
        "203.0.113.10",
        new Date(NOW.getTime() + 15 * 60 * 1_000),
      ),
    ).toBe(false);
    expect(
      reserveLoginAttempt(
        db,
        "alice",
        "203.0.113.10",
        new Date(NOW.getTime() + 15 * 60 * 1_000),
      ),
    ).toBe(true);
    expect(
      db.db
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.normalizedUsername, "alice"))
        .get()?.failureCount,
    ).toBe(1);
  });

  it("limits rotating usernames by source and prunes expired throttle rows", () => {
    const db = database();
    const source = "203.0.113.50";

    for (let attempt = 0; attempt < LOGIN_SOURCE_ATTEMPT_LIMIT; attempt += 1) {
      expect(reserveLoginAttempt(db, `user-${attempt}`, source, NOW)).toBe(true);
    }
    expect(reserveLoginAttempt(db, "one-more-user", source, NOW)).toBe(false);
    expect(db.db.select().from(authThrottle).all()).toHaveLength(
      LOGIN_SOURCE_ATTEMPT_LIMIT + 1,
    );

    const nextWindow = new Date(NOW.getTime() + 15 * 60 * 1_000);
    expect(reserveLoginAttempt(db, "fresh-user", source, nextWindow)).toBe(true);
    expect(db.db.select().from(authThrottle).all()).toHaveLength(2);
  });

  it("fails closed when the global throttle row cap is reached", () => {
    const db = database();
    db.sqlite
      .prepare(
        `with recursive counter(value) as (
          values(1)
          union all
          select value + 1 from counter where value < ?
        )
        insert into auth_throttle (
          normalized_username,
          source_hash,
          failure_count,
          window_started_at,
          updated_at
        )
        select 'seed-' || value, 'source-' || value, 1, ?, ? from counter`,
      )
      .run(LOGIN_THROTTLE_MAX_ROWS, NOW.getTime(), NOW.getTime());

    expect(reserveLoginAttempt(db, "new-user", "new-source", NOW)).toBe(false);
    expect(db.db.select().from(authThrottle).all()).toHaveLength(
      LOGIN_THROTTLE_MAX_ROWS,
    );
  });

  it("uses one public error for unknown, invalid and throttled logins", async () => {
    const db = database();
    await insertUser(db);
    const context = actionContext();

    const unknown = await loginAction(
      db,
      { username: "missing", password: "wrong" },
      context,
    );
    const invalid = await loginAction(
      db,
      { username: "alice", password: "wrong" },
      context,
    );
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await loginAction(
        db,
        { username: "alice", password: "wrong" },
        context,
      );
    }
    const throttled = await loginAction(
      db,
      { username: "alice", password: "initial password" },
      context,
    );

    for (const result of [unknown, invalid, throttled]) {
      expect(result).toMatchObject({
        ok: false,
        code: "INVALID_CREDENTIALS",
        message: GENERIC_LOGIN_ERROR,
      });
    }
  });

  it("rejects malformed or oversized login credentials before persistence", async () => {
    const db = database();
    await insertUser(db);
    const context = actionContext();
    const attempts = [
      { username: "ab", password: "initial password" },
      { username: "bad name", password: "initial password" },
      { username: "a".repeat(33), password: "initial password" },
      { username: "alice", password: "x".repeat(129) },
    ];

    for (const attempt of attempts) {
      await expect(loginAction(db, attempt, context)).resolves.toMatchObject({
        ok: false,
        code: "INVALID_CREDENTIALS",
        message: GENERIC_LOGIN_ERROR,
      });
    }
    expect(db.db.select().from(authThrottle).all()).toEqual([]);
  });

  it("uses one fail-closed source bucket when proxy headers are not trusted", async () => {
    const db = database();
    await insertUser(db);
    vi.stubEnv("TRUST_PROXY_HEADERS", "");

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await loginAction(
        db,
        { username: "alice", password: "wrong" },
        forwardedActionContext(`203.0.113.${attempt}`),
      );
    }
    const spoofedSixth = await loginAction(
      db,
      { username: "alice", password: "initial password" },
      forwardedActionContext("198.51.100.100"),
    );

    expect(spoofedSixth).toMatchObject({
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: GENERIC_LOGIN_ERROR,
    });
  });

  it("uses proxy-provided source buckets only when explicitly trusted", async () => {
    const db = database();
    await insertUser(db);
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await loginAction(
        db,
        { username: "alice", password: "wrong" },
        forwardedActionContext("203.0.113.10"),
      );
    }
    const differentSource = await loginAction(
      db,
      { username: "alice", password: "initial password" },
      forwardedActionContext("198.51.100.20"),
    );

    expect(differentSource).toMatchObject({ ok: true });
  });

  it("reserves the five throttle slots before concurrent password checks", async () => {
    const db = database();
    await insertUser(db);
    const context = actionContext(new TestCookies(), {
      source: "concurrent-source",
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        loginAction(db, { username: "alice", password: "wrong" }, context),
      ),
    );

    expect(results).toHaveLength(6);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(db.db.select().from(authThrottle).get()?.failureCount).toBe(5);
  });

  it("sets the hardened session cookie after login and clears it on logout", async () => {
    const db = database();
    const user = await insertUser(db);
    const cookies = new TestCookies();
    const context = actionContext(cookies);

    const result = await loginAction(
      db,
      { username: " ALICE ", password: "initial password" },
      context,
    );

    expect(result).toMatchObject({ ok: true });
    expect(
      db.db.select().from(users).where(eq(users.id, user.id)).get()?.lastLoginAt,
    ).toEqual(NOW);
    expect(cookies.writes[0]).toMatchObject({
      name: "request_manager_session",
      options: {
        expires: new Date(NOW.getTime() + 7 * DAY_MS),
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: true,
      },
    });
    expect(getSessionUser(db, cookies.writes[0].value, NOW)?.id).toBe(user.id);
    expect(
      db.db
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.normalizedUsername, "alice"))
        .all(),
    ).toHaveLength(0);
    expect(
      db.db
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.normalizedUsername, LOGIN_THROTTLE_SOURCE_KEY))
        .all(),
    ).toHaveLength(1);

    const logoutResult = await logoutAction(db, context);
    expect(logoutResult).toMatchObject({ ok: true });
    expect(db.db.select().from(sessions).all()).toHaveLength(0);
    expect(cookies.writes.at(-1)).toMatchObject({
      name: "request_manager_session",
      value: "",
      options: { expires: new Date(0) },
    });
  });

  it("updates only successful customer logins and keeps developer and failed attempts empty", async () => {
    const db = database();
    const customer = await insertUser(db, { username: "customer" });
    const developer = await insertUser(db, {
      username: "developer",
      role: "DEVELOPER",
    });
    const later = new Date(NOW.getTime() + 60_000);

    await loginAction(
      db,
      { username: "customer", password: "wrong" },
      actionContext(),
    );
    expect(
      db.db.select().from(users).where(eq(users.id, customer.id)).get()?.lastLoginAt,
    ).toBeNull();

    await loginAction(
      db,
      { username: "customer", password: "initial password" },
      actionContext(),
    );
    await loginAction(
      db,
      { username: "customer", password: "initial password" },
      actionContext(new TestCookies(), { now: later, source: "later-source" }),
    );
    await loginAction(
      db,
      { username: "developer", password: "initial password" },
      actionContext(new TestCookies(), { source: "developer-source" }),
    );

    expect(
      db.db.select().from(users).where(eq(users.id, customer.id)).get()?.lastLoginAt,
    ).toEqual(later);
    expect(
      db.db.select().from(users).where(eq(users.id, developer.id)).get()?.lastLoginAt,
    ).toBeNull();
  });

  it("changes the password, revokes all sessions and redirects to login", async () => {
    const db = database();
    const user = await insertUser(db);
    const first = createSession(db, user.id, NOW);
    createSession(db, user.id, NOW);
    const cookies = new TestCookies();
    cookies.values.set("request_manager_session", first.token);
    const redirect = vi.fn();
    const context = actionContext(cookies, { redirect });

    const result = await changeOwnPasswordAction(
      db,
      { oldPassword: "initial password", newPassword: "new secure password" },
      context,
    );

    expect(result).toMatchObject({ ok: true, data: { redirectTo: "/login" } });
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(db.db.select().from(sessions).all()).toHaveLength(0);
    const updated = db.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(updated?.mustChangePassword).toBe(false);
    await expect(
      verifyPassword("new secure password", updated!.passwordHash),
    ).resolves.toBe(true);
  });

  it.each([
    { length: 9, accepted: false },
    { length: 10, accepted: true },
    { length: 128, accepted: true },
    { length: 129, accepted: false },
  ])(
    "enforces the $length-character own-password boundary",
    async ({ length, accepted }) => {
      const db = database();
      const user = await insertUser(db);
      const session = createSession(db, user.id, NOW);
      const cookies = new TestCookies();
      cookies.values.set("request_manager_session", session.token);

      const result = await changeOwnPasswordAction(
        db,
        { oldPassword: "initial password", newPassword: "x".repeat(length) },
        actionContext(cookies, { redirect: vi.fn() }),
      );

      expect(result.ok).toBe(accepted);
      if (!accepted) {
        expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
        expect(getSessionUser(db, session.token, NOW)?.id).toBe(user.id);
      }
    },
  );
});
