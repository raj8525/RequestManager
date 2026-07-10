import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { canAccessProject } from "@/auth/authorization";
import { hashPassword } from "@/auth/password";
import { projectMemberships, projects, users } from "@/db/schema";
import { listManageableProjects } from "@/features/projects/queries";
import {
  createProject,
  setProjectActive,
  updateProject,
} from "@/features/projects/service";
import { createTestDatabase, type TestDatabase } from "@/../tests/helpers/test-database";

const NOW = new Date("2026-07-10T00:00:00.000Z");

async function insertUser(
  database: TestDatabase,
  username: string,
  role: "CUSTOMER" | "DEVELOPER",
) {
  const user = database.db
    .insert(users)
    .values({
      username,
      displayName: username,
      passwordHash: await hashPassword("initial password"),
      role,
      isActive: true,
      mustChangePassword: false,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
  return {
    ...user,
    mustChangePassword: false as const,
  };
}

describe("developer-managed projects", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function database() {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    return database;
  }

  it("allows only developers to create projects and requires a code and name", async () => {
    const db = database();
    const developer = await insertUser(db, "dev", "DEVELOPER");
    const customer = await insertUser(db, "customer", "CUSTOMER");

    const forbidden = await createProject(db, customer, {
      code: "APP",
      name: "Application",
      description: "",
    });
    expect(forbidden).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const invalid = await createProject(db, developer, {
      code: " ",
      name: "Application",
      description: "",
    });
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const created = await createProject(db, developer, {
      code: " APP ",
      name: " Application ",
      description: " Primary app ",
    });
    expect(created).toMatchObject({
      ok: true,
      data: {
        code: "APP",
        name: "Application",
        description: "Primary app",
        isActive: true,
      },
    });
  });

  it("enforces case-insensitive project-code uniqueness on create and update", async () => {
    const db = database();
    const developer = await insertUser(db, "dev", "DEVELOPER");
    const first = await createProject(db, developer, {
      code: "APP",
      name: "Application",
      description: "",
    });
    const second = await createProject(db, developer, {
      code: "WEB",
      name: "Website",
      description: "",
    });
    expect(first.ok && second.ok).toBe(true);

    const duplicate = await createProject(db, developer, {
      code: "app",
      name: "Duplicate",
      description: "",
    });
    expect(duplicate).toMatchObject({ ok: false, code: "CONFLICT" });

    if (!second.ok) throw new Error("fixture setup failed");
    const updateDuplicate = await updateProject(db, developer, {
      projectId: second.data.id,
      code: " App ",
      name: "Website",
      description: "",
    });
    expect(updateDuplicate).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("updates projects and lists active and disabled projects for developers", async () => {
    const db = database();
    const developer = await insertUser(db, "dev", "DEVELOPER");
    const created = await createProject(db, developer, {
      code: "APP",
      name: "Application",
      description: "Old",
    });
    if (!created.ok) throw new Error("fixture setup failed");

    const updated = await updateProject(db, developer, {
      projectId: created.data.id,
      code: "APP",
      name: "Renamed",
      description: "New",
    });
    expect(updated).toMatchObject({
      ok: true,
      data: { id: created.data.id, name: "Renamed", description: "New" },
    });

    const disabled = await setProjectActive(db, developer, {
      projectId: created.data.id,
      active: false,
    });
    expect(disabled).toMatchObject({
      ok: true,
      data: { id: created.data.id, isActive: false },
    });

    const listed = listManageableProjects(db, developer);
    expect(listed).toMatchObject({
      ok: true,
      data: [expect.objectContaining({ id: created.data.id, isActive: false })],
    });
  });

  it("keeps disabled projects readable to assigned customers while exposing them as inactive", async () => {
    const db = database();
    const developer = await insertUser(db, "dev", "DEVELOPER");
    const customer = await insertUser(db, "customer", "CUSTOMER");
    const project = db.db
      .insert(projects)
      .values({ code: "APP", name: "Application", createdAt: NOW, updatedAt: NOW })
      .returning()
      .get();
    db.db
      .insert(projectMemberships)
      .values({ customerId: customer.id, projectId: project.id })
      .run();

    await setProjectActive(db, developer, { projectId: project.id, active: false });

    expect(canAccessProject(db, customer, project.id)).toBe(true);
    expect(db.db.select().from(projects).where(eq(projects.id, project.id)).get()).toMatchObject({
      isActive: false,
    });
  });

  it("rejects customer project management queries and reports missing projects", async () => {
    const db = database();
    const developer = await insertUser(db, "dev", "DEVELOPER");
    const customer = await insertUser(db, "customer", "CUSTOMER");

    expect(listManageableProjects(db, customer)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    await expect(
      setProjectActive(db, developer, { projectId: 999_999, active: false }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
