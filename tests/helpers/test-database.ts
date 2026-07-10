import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, createDatabase } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import type { AppDatabase } from "@/db/types";

export type TestDatabase = AppDatabase & {
  cleanup: () => void;
};

export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "request-manager-test-"));
  const database = createDatabase(join(directory, "test.db"));
  let closed = false;

  try {
    migrateDatabase(database);
  } catch (error) {
    closeDatabase(database);
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }

  return {
    ...database,
    cleanup: () => {
      if (closed) return;
      closed = true;
      closeDatabase(database);
      rmSync(directory, { force: true, recursive: true });
    },
  };
}
