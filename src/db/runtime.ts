import type { AppDatabase } from "@/db/types";
import { getEnvironment } from "@/lib/env";

import { createDatabase } from "./client";

const RUNTIME_DATABASE_KEY = Symbol.for("request-manager.runtime-database");

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_DATABASE_KEY]?: AppDatabase;
};

export function getRuntimeDatabase(): AppDatabase {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal[RUNTIME_DATABASE_KEY] ??= createDatabase(
    getEnvironment().databasePath,
  );
  return runtimeGlobal[RUNTIME_DATABASE_KEY];
}
