import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { assertSafeManagedFilePath } from "@/ops/paths";

const INCOMPLETE_LOCK_GRACE_MS = 30_000;

const lockMetadataSchema = z
  .object({
    version: z.literal(1),
    pid: z.number().int().positive(),
    owner: z.string().min(1),
    token: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

type LockMetadata = z.infer<typeof lockMetadataSchema>;

export type DatabaseProcessLock = {
  databasePath: string;
  owner: string;
  path: string;
  release: () => void;
};

export function databaseProcessLockPath(databasePath: string): string {
  return `${resolve(databasePath)}.process-lock`;
}

function readLockMetadata(path: string): LockMetadata | null {
  try {
    return lockMetadataSchema.parse(
      JSON.parse(readFileSync(path, "utf8")) as unknown,
    );
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function retireStaleLock(path: string): boolean {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("database process lock must be a regular file");
  }
  const metadata = readLockMetadata(path);
  if (metadata && processIsAlive(metadata.pid)) {
    throw new Error(
      `database process lock is held by ${metadata.owner} (pid ${metadata.pid})`,
    );
  }
  if (!metadata && Date.now() - stats.mtimeMs < INCOMPLETE_LOCK_GRACE_MS) {
    throw new Error("database process lock is being initialized");
  }

  const retiredPath = `${path}.stale-${randomUUID()}`;
  try {
    renameSync(path, retiredPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  rmSync(retiredPath, { force: true });
  return true;
}

export function acquireDatabaseProcessLock(
  databasePathInput: string,
  owner: string,
): DatabaseProcessLock {
  if (!owner.trim()) throw new Error("database process lock owner is required");
  const databasePath = assertSafeManagedFilePath(
    databasePathInput,
    "database file",
  );
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const path = databaseProcessLockPath(databasePath);
  const token = randomUUID();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor: number | null = null;
    try {
      descriptor = openSync(path, "wx", 0o600);
      const metadata: LockMetadata = {
        version: 1,
        pid: process.pid,
        owner,
        token,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(descriptor, `${JSON.stringify(metadata)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;

      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        process.off("exit", release);
        if (readLockMetadata(path)?.token === token) {
          rmSync(path, { force: true });
        }
      };
      process.once("exit", release);
      return { databasePath, owner, path, release };
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        rmSync(path, { force: true });
        throw error;
      }
      retireStaleLock(path);
    }
  }
  throw new Error("database process lock could not be acquired");
}
