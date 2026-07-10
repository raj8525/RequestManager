import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { AppDatabase } from "@/db/types";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export function migrateDatabase(database: AppDatabase): void {
  migrate(database.db, { migrationsFolder });
}

export function getSchemaVersion(database: AppDatabase): number {
  const table = database.sqlite
    .prepare(
      "select 1 as present from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
    )
    .get() as { present: number } | undefined;
  if (!table) return 0;
  const row = database.sqlite
    .prepare("select count(*) as version from __drizzle_migrations")
    .get() as { version: number };
  return row.version;
}
