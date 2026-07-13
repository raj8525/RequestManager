import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireDatabaseProcessLock,
  databaseProcessLockPath,
} from "@/ops/process-lock";

const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");

describe("database process lock", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  function databasePath(): string {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "request-manager-process-lock-")),
    );
    cleanups.push(() => rmSync(root, { force: true, recursive: true }));
    return join(root, "request-manager.db");
  }

  it("prevents the application runtime from opening while restore owns the lock", () => {
    const path = databasePath();
    const restoreLock = acquireDatabaseProcessLock(path, "restore");
    try {
      const child = spawnSync(
        tsx,
        [
          "-e",
          'import { getRuntimeDatabase } from "./src/db/runtime.ts"; getRuntimeDatabase();',
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_PATH: path,
            UPLOADS_PATH: join(path, "..", "uploads"),
            TEMP_UPLOADS_PATH: join(path, "..", "tmp"),
          },
        },
      );
      expect(child.status).not.toBe(0);
      expect(child.stderr).toMatch(/lock|restore|running/i);
    } finally {
      restoreLock.release();
    }
  });

  it("recovers a stale lock whose owning process is no longer alive", () => {
    const path = databasePath();
    const lockPath = databaseProcessLockPath(path);
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        owner: "application",
        token: "stale-token",
        createdAt: "2020-01-01T00:00:00.000Z",
      })}\n`,
    );
    utimesSync(lockPath, new Date(0), new Date(0));

    const lock = acquireDatabaseProcessLock(path, "restore");
    expect(lock.owner).toBe("restore");
    lock.release();
  });

  it("recovers a legacy lock when a restarted container reuses the same pid", () => {
    const path = databasePath();
    const lockPath = databaseProcessLockPath(path);
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        version: 1,
        pid: process.pid,
        owner: "application",
        token: "previous-container-token",
        createdAt: "2020-01-01T00:00:00.000Z",
      })}\n`,
    );

    const lock = acquireDatabaseProcessLock(path, "application");
    expect(lock.owner).toBe("application");
    lock.release();
  });

  it("still rejects a second lock from the same live process instance", () => {
    const path = databasePath();
    const first = acquireDatabaseProcessLock(path, "application");
    try {
      expect(() => acquireDatabaseProcessLock(path, "restore")).toThrow(
        /held by application/,
      );
    } finally {
      first.release();
    }
  });

  it("records Linux process start identity to distinguish reused pids", () => {
    if (process.platform !== "linux") return;
    const path = databasePath();
    const lockPath = databaseProcessLockPath(path);
    const lock = acquireDatabaseProcessLock(path, "application");
    try {
      const metadata = JSON.parse(readFileSync(lockPath, "utf8")) as {
        processStartIdentity?: string;
      };
      expect(metadata.processStartIdentity).toMatch(/^\d+$/);
    } finally {
      lock.release();
    }
  });
});
