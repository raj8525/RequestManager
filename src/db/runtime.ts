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

type RuntimeProcess = NodeJS.Process & {
  [RUNTIME_DATABASE_KEY]?: AppDatabase;
  [RUNTIME_DATABASE_LOCK_KEY]?: DatabaseProcessLock;
};

const runtimeProcess = process as RuntimeProcess;

export function getRuntimeDatabase(): AppDatabase {
  if (!runtimeProcess[RUNTIME_DATABASE_KEY]) {
    const lock = acquireDatabaseProcessLock(
      getEnvironment().databasePath,
      "application",
    );
    try {
      runtimeProcess[RUNTIME_DATABASE_KEY] = createDatabase(lock.databasePath);
      runtimeProcess[RUNTIME_DATABASE_LOCK_KEY] = lock;
    } catch (error) {
      lock.release();
      throw error;
    }
  }
  return runtimeProcess[RUNTIME_DATABASE_KEY];
}

export function closeRuntimeDatabase(): void {
  if (runtimeProcess[RUNTIME_DATABASE_KEY]) {
    closeDatabase(runtimeProcess[RUNTIME_DATABASE_KEY]);
    delete runtimeProcess[RUNTIME_DATABASE_KEY];
  }
  runtimeProcess[RUNTIME_DATABASE_LOCK_KEY]?.release();
  delete runtimeProcess[RUNTIME_DATABASE_LOCK_KEY];
}
