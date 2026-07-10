import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";
import type { AppDatabase } from "@/db/types";

export function createDatabase(databasePath: string): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function closeDatabase(database: AppDatabase): void {
  database.sqlite.close();
}
