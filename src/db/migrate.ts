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
