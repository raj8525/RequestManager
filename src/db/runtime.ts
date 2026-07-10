import type { AppDatabase } from "@/db/types";
import { getEnvironment } from "@/lib/env";
import {
  acquireDatabaseProcessLock,
  type DatabaseProcessLock,
} from "@/ops/process-lock";

import { closeDatabase, createDatabase } from "./client";

const RUNTIME_DATABASE_KEY = Symbol.for("request-manager.runtime-database");
const RUNTIME_DATABASE_LOCK_KEY = Symbol.for(
  "request-manager.runtime-database-lock",
);

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_DATABASE_KEY]?: AppDatabase;
  [RUNTIME_DATABASE_LOCK_KEY]?: DatabaseProcessLock;
};

export function getRuntimeDatabase(): AppDatabase {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  if (!runtimeGlobal[RUNTIME_DATABASE_KEY]) {
    const lock = acquireDatabaseProcessLock(
      getEnvironment().databasePath,
      "application",
    );
    try {
      runtimeGlobal[RUNTIME_DATABASE_KEY] = createDatabase(lock.databasePath);
      runtimeGlobal[RUNTIME_DATABASE_LOCK_KEY] = lock;
    } catch (error) {
      lock.release();
      throw error;
    }
  }
  return runtimeGlobal[RUNTIME_DATABASE_KEY];
}

export function closeRuntimeDatabase(): void {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  if (runtimeGlobal[RUNTIME_DATABASE_KEY]) {
    closeDatabase(runtimeGlobal[RUNTIME_DATABASE_KEY]);
    delete runtimeGlobal[RUNTIME_DATABASE_KEY];
  }
  runtimeGlobal[RUNTIME_DATABASE_LOCK_KEY]?.release();
  delete runtimeGlobal[RUNTIME_DATABASE_LOCK_KEY];
}
