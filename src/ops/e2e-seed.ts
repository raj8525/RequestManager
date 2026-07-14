import { existsSync, rmSync } from "node:fs";

import { hashPassword } from "@/auth/password";
import { closeDatabase, createDatabase } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import { projectMemberships, projects, requests, users } from "@/db/schema";
import {
  assertIndependentPaths,
  assertSafeManagedFilePath,
  assertSafeManagedPath,
} from "@/ops/paths";

export type SeedEndToEndOptions = {
  nodeEnvironment: string | undefined;
  databasePath: string;
  uploadsPath: string;
  liveDatabasePath: string;
  liveUploadsPath: string;
  password?: string;
};

export async function seedEndToEndData(options: SeedEndToEndOptions): Promise<void> {
  if (options.nodeEnvironment !== "test") {
    throw new Error("E2E seed is available only when NODE_ENV=test");
  }
  const databasePath = assertSafeManagedFilePath(
    options.databasePath,
    "E2E database file",
  );
  const uploadsPath = assertSafeManagedPath(
    options.uploadsPath,
    "E2E uploads directory",
  );
  const liveDatabasePath = assertSafeManagedFilePath(
    options.liveDatabasePath,
    "live database file",
  );
  const liveUploadsPath = assertSafeManagedPath(
    options.liveUploadsPath,
    "live uploads directory",
  );
  const managedPaths = [
    [databasePath, "E2E database file"],
    [uploadsPath, "E2E uploads directory"],
    [liveDatabasePath, "live database file"],
    [liveUploadsPath, "live uploads directory"],
  ] as const;
  for (let first = 0; first < managedPaths.length; first += 1) {
    for (let second = first + 1; second < managedPaths.length; second += 1) {
      assertIndependentPaths(
        managedPaths[first]![0],
        managedPaths[first]![1],
        managedPaths[second]![0],
        managedPaths[second]![1],
      );
    }
  }

  if (existsSync(databasePath)) rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(uploadsPath, { force: true, recursive: true });

  const passwordHash = await hashPassword(options.password ?? "e2e secure password");
  const database = createDatabase(databasePath);
  try {
    migrateDatabase(database);
    const now = new Date();
    const seededUsers = database.db
      .insert(users)
      .values([
        {
          username: "developer-a",
          displayName: "Developer A",
          passwordHash,
          role: "DEVELOPER" as const,
          isActive: true,
          mustChangePassword: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          username: "developer-b",
          displayName: "Developer B",
          passwordHash,
          role: "DEVELOPER" as const,
          isActive: true,
          mustChangePassword: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          username: "customer-a",
          displayName: "Customer A",
          passwordHash,
          role: "CUSTOMER" as const,
          isActive: true,
          mustChangePassword: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          username: "customer-b",
          displayName: "Customer B",
          passwordHash,
          role: "CUSTOMER" as const,
          isActive: true,
          mustChangePassword: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          username: "unassigned-customer",
          displayName: "Unassigned Customer",
          passwordHash,
          role: "CUSTOMER" as const,
          isActive: true,
          mustChangePassword: false,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning()
      .all();
    const project = database.db
      .insert(projects)
      .values({
        code: "PROJECT-A",
        name: "Project A",
        description: "E2E project",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const customerIds = seededUsers
      .filter((user) => user.username === "customer-a" || user.username === "customer-b")
      .map((user) => user.id);
    database.db
      .insert(projectMemberships)
      .values(
        customerIds.map((customerId) => ({
          customerId,
          projectId: project.id,
          createdAt: now,
        })),
      )
      .run();
    const customerA = seededUsers.find((user) => user.username === "customer-a");
    if (!customerA) throw new Error("customer-a seed is missing");
    database.db.insert(requests).values({
      projectId: project.id,
      createdById: customerA.id,
      title: null,
      content: "这是迁移前创建的历史需求正文，只允许客户补充一次标题。",
      requestType: "CHANGE",
      priority: "IMPORTANT",
      progressStatus: "COMPLETED",
      recordStatus: "ARCHIVED",
      idempotencyKey: "legacy-title-e2e",
      createPayloadFingerprint: "legacy-e2e",
      createdAt: now,
      updatedAt: now,
    }).run();
  } finally {
    closeDatabase(database);
  }
}
