import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { canAccessProject } from "@/auth/authorization";
import { hashPassword, verifyPassword } from "@/auth/password";
import { createSession, getSessionUser } from "@/auth/session-service";
import { projectMemberships, projects, sessions, users } from "@/db/schema";
import {
  createUser,
  replaceCustomerMemberships,
  resetUserPassword,
  setUserActive,
  updateUserIdentity,
} from "@/features/accounts/service";
import {
  listManageableUsers,
  listManageableUsersWithMemberships,
} from "@/features/accounts/queries";
import { createTestDatabase, type TestDatabase } from "@/../tests/helpers/test-database";

const NOW = new Date("2026-07-10T00:00:00.000Z");

async function insertUser(
  database: TestDatabase,
  input: {
    username: string;
    role: "CUSTOMER" | "DEVELOPER";
    isActive?: boolean;
  },
) {
  return database.db
    .insert(users)
    .values({
      username: input.username,
      displayName: input.username,
      passwordHash: await hashPassword("initial password"),
      role: input.role,
      isActive: input.isActive ?? true,
      mustChangePassword: false,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
}

function actorFor(user: Awaited<ReturnType<typeof insertUser>>) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: false,
  };
}

describe("developer-managed accounts", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function database() {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    return database;
  }

  it("allows only developers to create accounts and normalizes usernames", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const customer = await insertUser(db, { username: "customer", role: "CUSTOMER" });

    const forbidden = await createUser(db, actorFor(customer), {
      username: "blocked",
      displayName: "Blocked",
      password: "temporary password",
      role: "CUSTOMER",
    });
    expect(forbidden).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const created = await createUser(db, actorFor(developer), {
      username: "  Alice.Admin  ",
      displayName: "Alice 管理员",
      password: "temporary password",
      role: "DEVELOPER",
    });
    expect(created).toMatchObject({
      ok: true,
      data: {
        username: "alice.admin",
        displayName: "Alice 管理员",
        role: "DEVELOPER",
        isActive: true,
        mustChangePassword: true,
      },
    });
    expect(created.ok && "passwordHash" in created.data).toBe(false);
    expect(
      await verifyPassword(
        "temporary password",
        db.db.select().from(users).where(eq(users.username, "alice.admin")).get()!
          .passwordHash,
      ),
    ).toBe(true);
  });

  it("validates usernames and enforces case-insensitive uniqueness on create and update", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const first = await insertUser(db, { username: "alice", role: "CUSTOMER" });
    const second = await insertUser(db, { username: "bob", role: "CUSTOMER" });

    const invalid = await createUser(db, actorFor(developer), {
      username: "bad name",
      displayName: "Bad",
      password: "temporary password",
      role: "CUSTOMER",
    });
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const duplicate = await createUser(db, actorFor(developer), {
      username: " ALICE ",
      displayName: "Other Alice",
      password: "temporary password",
      role: "CUSTOMER",
    });
    expect(duplicate).toMatchObject({ ok: false, code: "CONFLICT" });

    const updateDuplicate = await updateUserIdentity(db, actorFor(developer), {
      userId: second.id,
      username: "Alice",
      displayName: "Bob",
    });
    expect(updateDuplicate).toMatchObject({ ok: false, code: "CONFLICT" });

    const updated = await updateUserIdentity(db, actorFor(developer), {
      userId: first.id,
      username: " Alice.New ",
      displayName: "Alice New",
    });
    expect(updated).toMatchObject({
      ok: true,
      data: { id: first.id, username: "alice.new", role: "CUSTOMER" },
    });
  });

  it("enforces the shared 10-128 character password policy on create and reset", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const customer = await insertUser(db, { username: "alice", role: "CUSTOMER" });

    for (const { length, accepted } of [
      { length: 9, accepted: false },
      { length: 10, accepted: true },
      { length: 128, accepted: true },
      { length: 129, accepted: false },
    ]) {
      const created = await createUser(db, actorFor(developer), {
        username: `created-${length}`,
        displayName: `Created ${length}`,
        password: "x".repeat(length),
        role: "CUSTOMER",
      });
      expect(created.ok, `create length ${length}`).toBe(accepted);

      const reset = await resetUserPassword(db, actorFor(developer), {
        userId: customer.id,
        password: "y".repeat(length),
      });
      expect(reset.ok, `reset length ${length}`).toBe(accepted);
      if (!accepted) {
        expect(created).toMatchObject({ ok: false, code: "INVALID_INPUT" });
        expect(reset).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      }
    }
  });

  it("resets a password with a fresh hash, forces password change and revokes all sessions", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const customer = await insertUser(db, { username: "alice", role: "CUSTOMER" });
    const firstSession = createSession(db, customer.id, NOW);
    const secondSession = createSession(db, customer.id, NOW);
    const oldHash = customer.passwordHash;

    const result = await resetUserPassword(db, actorFor(developer), {
      userId: customer.id,
      password: "replacement password",
    });

    expect(result).toMatchObject({
      ok: true,
      data: { id: customer.id, mustChangePassword: true },
    });
    const stored = db.db.select().from(users).where(eq(users.id, customer.id)).get()!;
    expect(stored.passwordHash).not.toBe(oldHash);
    expect(await verifyPassword("replacement password", stored.passwordHash)).toBe(true);
    expect(getSessionUser(db, firstSession.token, NOW)).toBeNull();
    expect(getSessionUser(db, secondSession.token, NOW)).toBeNull();
  });

  it("prevents a developer from disabling self or the last active developer", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });

    await expect(
      setUserActive(db, actorFor(developer), {
        userId: developer.id,
        active: false,
      }),
    ).resolves.toMatchObject({ ok: false, code: "LAST_DEVELOPER" });
    expect(db.db.select().from(users).where(eq(users.id, developer.id)).get()?.isActive).toBe(
      true,
    );
  });

  it("disables other accounts, revokes their sessions and never exposes password hashes", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const customer = await insertUser(db, { username: "alice", role: "CUSTOMER" });
    createSession(db, customer.id, NOW);

    const disabled = await setUserActive(db, actorFor(developer), {
      userId: customer.id,
      active: false,
    });
    expect(disabled).toMatchObject({ ok: true, data: { id: customer.id, isActive: false } });
    expect(db.db.select().from(sessions).where(eq(sessions.userId, customer.id)).all()).toEqual(
      [],
    );

    const listed = listManageableUsers(db, actorFor(developer));
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: customer.id, username: "alice", isActive: false }),
        ]),
      );
      expect(listed.data.some((user) => "passwordHash" in user)).toBe(false);
    }
  });

  it("returns customer memberships in the management DTO without account secrets", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const customer = await insertUser(db, { username: "alice", role: "CUSTOMER" });
    const lastLoginAt = new Date("2026-07-22T03:04:00.000Z");
    db.db
      .update(users)
      .set({ lastLoginAt })
      .where(eq(users.id, customer.id))
      .run();
    const project = db.db
      .insert(projects)
      .values({ code: "ONE", name: "One", createdAt: NOW, updatedAt: NOW })
      .returning()
      .get();
    db.db
      .insert(projectMemberships)
      .values({ customerId: customer.id, projectId: project.id })
      .run();

    const result = listManageableUsersWithMemberships(db, actorFor(developer));

    expect(result).toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          id: customer.id,
          username: "alice",
          lastLoginAt,
          projectIds: [project.id],
        }),
      ]),
    });
    if (result.ok) {
      expect(result.data.some((user) => "passwordHash" in user)).toBe(false);
    }
  });

  it("replaces customer memberships atomically and revokes project access immediately", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const customer = await insertUser(db, { username: "alice", role: "CUSTOMER" });
    const [firstProject, secondProject] = db.db
      .insert(projects)
      .values([
        { code: "ONE", name: "One", createdAt: NOW, updatedAt: NOW },
        { code: "TWO", name: "Two", isActive: false, createdAt: NOW, updatedAt: NOW },
      ])
      .returning()
      .all();
    db.db
      .insert(projectMemberships)
      .values({ customerId: customer.id, projectId: firstProject.id })
      .run();

    const replaced = await replaceCustomerMemberships(db, actorFor(developer), {
      customerId: customer.id,
      projectIds: [secondProject.id],
    });

    expect(replaced).toMatchObject({
      ok: true,
      data: { customerId: customer.id, projectIds: [secondProject.id] },
    });
    expect(canAccessProject(db, actorFor(customer), firstProject.id)).toBe(false);
    expect(canAccessProject(db, actorFor(customer), secondProject.id)).toBe(true);
  });

  it("rechecks live developer authorization for every account command", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const staleActor = actorFor(developer);
    const customer = await insertUser(db, { username: "alice", role: "CUSTOMER" });
    const project = db.db
      .insert(projects)
      .values({ code: "ONE", name: "One", createdAt: NOW, updatedAt: NOW })
      .returning()
      .get();
    const originalPasswordHash = customer.passwordHash;
    db.db.update(users).set({ isActive: false }).where(eq(users.id, developer.id)).run();

    const results = await Promise.all([
      createUser(db, staleActor, {
        username: "new-customer",
        displayName: "New customer",
        password: "temporary password",
        role: "CUSTOMER",
      }),
      updateUserIdentity(db, staleActor, {
        userId: customer.id,
        username: "changed",
        displayName: "Changed",
      }),
      resetUserPassword(db, staleActor, {
        userId: customer.id,
        password: "replacement password",
      }),
      setUserActive(db, staleActor, { userId: customer.id, active: false }),
      replaceCustomerMemberships(db, staleActor, {
        customerId: customer.id,
        projectIds: [project.id],
      }),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(db.db.select().from(users).where(eq(users.id, customer.id)).get()).toMatchObject({
      username: "alice",
      displayName: "alice",
      passwordHash: originalPasswordHash,
      isActive: true,
    });
    expect(db.db.select().from(users).where(eq(users.username, "new-customer")).get()).toBeUndefined();
    expect(
      db.db
        .select()
        .from(projectMemberships)
        .where(eq(projectMemberships.customerId, customer.id))
        .all(),
    ).toEqual([]);
  });

  it("rejects inactive or non-customer membership targets and missing projects without partial writes", async () => {
    const db = database();
    const developer = await insertUser(db, { username: "dev", role: "DEVELOPER" });
    const inactiveCustomer = await insertUser(db, {
      username: "inactive",
      role: "CUSTOMER",
      isActive: false,
    });
    const otherDeveloper = await insertUser(db, {
      username: "other-dev",
      role: "DEVELOPER",
    });
    const activeCustomer = await insertUser(db, {
      username: "active",
      role: "CUSTOMER",
    });
    const project = db.db
      .insert(projects)
      .values({ code: "ONE", name: "One", createdAt: NOW, updatedAt: NOW })
      .returning()
      .get();
    db.db
      .insert(projectMemberships)
      .values({ customerId: activeCustomer.id, projectId: project.id })
      .run();

    for (const customerId of [inactiveCustomer.id, otherDeveloper.id]) {
      const result = await replaceCustomerMemberships(db, actorFor(developer), {
        customerId,
        projectIds: [project.id],
      });
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }

    const missing = await replaceCustomerMemberships(db, actorFor(developer), {
      customerId: activeCustomer.id,
      projectIds: [project.id, 999_999],
    });
    expect(missing).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      db.db
        .select({ customerId: projectMemberships.customerId, projectId: projectMemberships.projectId })
        .from(projectMemberships)
        .where(eq(projectMemberships.customerId, activeCustomer.id))
        .all(),
    ).toEqual([{ customerId: activeCustomer.id, projectId: project.id }]);
    expect(
      db.db
        .select()
        .from(projectMemberships)
        .where(inArray(projectMemberships.customerId, [inactiveCustomer.id, otherDeveloper.id]))
        .all(),
    ).toEqual([]);
  });
});
