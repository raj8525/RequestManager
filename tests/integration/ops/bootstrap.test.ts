import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { verifyPassword } from "@/auth/password";
import { seedEndToEndData } from "@/ops/e2e-seed";
import { assertSafeManagedPath } from "@/ops/paths";
import { serializeStructuredLog } from "@/ops/structured-log";

const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runScript(
  script: string,
  environment: Record<string, string>,
  args: string[] = [],
): CommandResult {
  const result = spawnSync(tsx, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("explicit migration and first-developer bootstrap", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  function isolatedPaths() {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "request-manager-ops-bootstrap-")),
    );
    cleanups.push(() => rmSync(root, { force: true, recursive: true }));
    return {
      root,
      databasePath: join(root, "request-manager.db"),
      uploadsPath: join(root, "uploads"),
      temporaryUploadsPath: join(root, "tmp"),
    };
  }

  it("prints before and after schema versions from an explicit migration", () => {
    const paths = isolatedPaths();
    const result = runScript("scripts/migrate.ts", {
      DATABASE_PATH: paths.databasePath,
      UPLOADS_PATH: paths.uploadsPath,
      TEMP_UPLOADS_PATH: paths.temporaryUploadsPath,
    });

    expect(result.status, result.stderr).toBe(0);
    const log = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(log).toMatchObject({
      event: "database_migrated",
      beforeVersion: 0,
      afterVersion: 4,
    });
  });

  it("creates only the first enabled developer and never prints or overwrites its password", async () => {
    const paths = isolatedPaths();
    const common = {
      DATABASE_PATH: paths.databasePath,
      UPLOADS_PATH: paths.uploadsPath,
      TEMP_UPLOADS_PATH: paths.temporaryUploadsPath,
      ADMIN_USERNAME: "admin",
      ADMIN_DISPLAY_NAME: "Operations Admin",
    };
    expect(runScript("scripts/migrate.ts", common).status).toBe(0);

    const first = runScript("scripts/init-developer.ts", {
      ...common,
      ADMIN_PASSWORD: "first secure password",
    });
    const second = runScript("scripts/init-developer.ts", {
      ...common,
      ADMIN_PASSWORD: "changed secure password",
    });

    expect(first.status, first.stderr).toBe(0);
    expect(second.status).not.toBe(0);
    expect(first.stdout + first.stderr + second.stdout + second.stderr).not.toContain(
      "first secure password",
    );
    expect(first.stdout + first.stderr + second.stdout + second.stderr).not.toContain(
      "changed secure password",
    );

    const sqlite = new Database(paths.databasePath, { readonly: true });
    try {
      const row = sqlite
        .prepare(
          "select username, password_hash as passwordHash from users where role = 'DEVELOPER' and is_active = 1",
        )
        .get() as { username: string; passwordHash: string };
      expect(row.username).toBe("admin");
      await expect(
        verifyPassword("first secure password", row.passwordHash),
      ).resolves.toBe(true);
      await expect(
        verifyPassword("changed secure password", row.passwordHash),
      ).resolves.toBe(false);
    } finally {
      sqlite.close();
    }
  });

  it("redacts sensitive nested fields from single-line operational logs", () => {
    const line = serializeStructuredLog("operation_failed", {
      timestamp: "forged timestamp",
      event: "forged_event",
      requestId: "req-1",
      password: "do-not-log",
      accessToken: "secret-token",
      requestBody: "private request body",
      nested: { privateNote: "private note", code: "FAILED" },
    });

    expect(line).not.toContain("do-not-log");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("private request body");
    expect(line).not.toContain("private note");
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      event: "operation_failed",
      requestId: "req-1",
      password: "[REDACTED]",
      nested: { privateNote: "[REDACTED]", code: "FAILED" },
    });
    expect(JSON.parse(line).timestamp).not.toBe("forged timestamp");
  });

  it("rejects filesystem roots and dangerous shared directories", () => {
    expect(() => assertSafeManagedPath("/", "uploads directory")).toThrow();
    expect(() => assertSafeManagedPath("/etc", "uploads directory")).toThrow();
    expect(() => assertSafeManagedPath("/usr", "uploads directory")).toThrow();
    expect(() => assertSafeManagedPath(tmpdir(), "uploads directory")).toThrow();
    expect(() => assertSafeManagedPath(process.cwd(), "uploads directory")).toThrow();

    const paths = isolatedPaths();
    expect(assertSafeManagedPath(paths.uploadsPath, "uploads directory")).toBe(
      paths.uploadsPath,
    );
  });

  it("allows E2E seed only in test mode with paths independent from live data", () => {
    const paths = isolatedPaths();
    const production = runScript("scripts/e2e-seed.ts", {
      NODE_ENV: "production",
      DATABASE_PATH: paths.databasePath,
      UPLOADS_PATH: paths.uploadsPath,
      E2E_DATABASE_PATH: join(paths.root, "e2e.db"),
      E2E_UPLOADS_PATH: join(paths.root, "e2e-uploads"),
    });
    expect(production.status).not.toBe(0);

    const shared = runScript("scripts/e2e-seed.ts", {
      NODE_ENV: "test",
      DATABASE_PATH: paths.databasePath,
      UPLOADS_PATH: paths.uploadsPath,
      E2E_DATABASE_PATH: paths.databasePath,
      E2E_UPLOADS_PATH: join(paths.root, "e2e-uploads"),
    });
    expect(shared.status).not.toBe(0);
    expect(() => readFileSync(paths.databasePath)).toThrow();

    const e2eDatabasePath = join(paths.root, "e2e", "request-manager.db");
    const seeded = runScript("scripts/e2e-seed.ts", {
      NODE_ENV: "test",
      DATABASE_PATH: paths.databasePath,
      UPLOADS_PATH: paths.uploadsPath,
      E2E_DATABASE_PATH: e2eDatabasePath,
      E2E_UPLOADS_PATH: join(paths.root, "e2e", "uploads"),
    });
    expect(seeded.status, seeded.stderr).toBe(0);
    const sqlite = new Database(e2eDatabasePath, { readonly: true });
    try {
      expect(
        (
          sqlite
            .prepare("select count(*) as count from users")
            .get() as { count: number }
        ).count,
      ).toBe(5);
    } finally {
      sqlite.close();
    }
  });

  it("rejects every E2E/live cross-path overlap before deleting seed data", async () => {
    const paths = isolatedPaths();
    const liveUploadsPath = join(paths.root, "live-uploads");
    mkdirSync(liveUploadsPath, { recursive: true });
    const liveDatabasePath = join(paths.root, "live-container", "live.db");
    mkdirSync(join(paths.root, "live-container"), { recursive: true });
    writeFileSync(liveDatabasePath, "live database sentinel");

    await expect(
      seedEndToEndData({
        nodeEnvironment: "test",
        databasePath: join(paths.root, "e2e.db"),
        uploadsPath: join(paths.root, "live-container"),
        liveDatabasePath,
        liveUploadsPath,
      }),
    ).rejects.toThrow(/independent/i);
    expect(readFileSync(liveDatabasePath, "utf8")).toBe(
      "live database sentinel",
    );

    const e2eDatabaseInsideLiveUploads = join(liveUploadsPath, "e2e.db");
    writeFileSync(e2eDatabaseInsideLiveUploads, "live uploads sentinel");
    await expect(
      seedEndToEndData({
        nodeEnvironment: "test",
        databasePath: e2eDatabaseInsideLiveUploads,
        uploadsPath: join(paths.root, "e2e-uploads"),
        liveDatabasePath,
        liveUploadsPath,
      }),
    ).rejects.toThrow(/independent/i);
    expect(readFileSync(e2eDatabaseInsideLiveUploads, "utf8")).toBe(
      "live uploads sentinel",
    );
  });

  it("rejects an E2E path reached through an ancestor symbolic link", async () => {
    const paths = isolatedPaths();
    const actualE2eRoot = join(paths.root, "actual-e2e");
    const actualUploads = join(actualE2eRoot, "uploads");
    mkdirSync(actualUploads, { recursive: true });
    const sentinel = join(actualUploads, "keep.txt");
    writeFileSync(sentinel, "keep");
    const aliasRoot = join(paths.root, "e2e-alias");
    symlinkSync(actualE2eRoot, aliasRoot, "dir");

    await expect(
      seedEndToEndData({
        nodeEnvironment: "test",
        databasePath: join(paths.root, "e2e.db"),
        uploadsPath: join(aliasRoot, "uploads"),
        liveDatabasePath: paths.databasePath,
        liveUploadsPath: paths.uploadsPath,
      }),
    ).rejects.toThrow(/symbolic/i);
    expect(existsSync(sentinel)).toBe(true);
  });
});
