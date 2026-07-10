import { resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

import type Database from "better-sqlite3";

import type { AppDatabase } from "@/db/types";

const migrationsFolder = resolve(process.cwd(), "drizzle");

export function migrateDatabase(database: AppDatabase): void {
  migrate(database.db, { migrationsFolder });
}

export function getSchemaVersion(database: AppDatabase): number {
  return getAppliedMigrationJournal(database.sqlite).length;
}

export type MigrationJournalEntry = {
  ordinal: number;
  hash: string;
  createdAt: number;
};

function hasMigrationTable(sqlite: Database.Database): boolean {
  return Boolean(
    sqlite
    .prepare(
      "select 1 as present from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
    )
      .get() as { present: number } | undefined,
  );
}

export function getAppliedMigrationJournal(
  sqlite: Database.Database,
): MigrationJournalEntry[] {
  if (!hasMigrationTable(sqlite)) return [];
  const rows = sqlite
    .prepare(
      "select hash, created_at as createdAt from __drizzle_migrations order by rowid",
    )
    .all() as Array<{ hash: unknown; createdAt: unknown }>;
  return rows.map((row, ordinal) => {
    if (
      typeof row.hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.hash) ||
      typeof row.createdAt !== "number" ||
      !Number.isSafeInteger(row.createdAt)
    ) {
      throw new Error("database migration journal is invalid");
    }
    return { ordinal, hash: row.hash, createdAt: row.createdAt };
  });
}

export function getExpectedMigrationJournal(): MigrationJournalEntry[] {
  return readMigrationFiles({ migrationsFolder }).map((migration, ordinal) => ({
    ordinal,
    hash: migration.hash,
    createdAt: migration.folderMillis,
  }));
}

export function assertCurrentMigrationJournal(
  journal: MigrationJournalEntry[],
): void {
  if (JSON.stringify(journal) !== JSON.stringify(getExpectedMigrationJournal())) {
    throw new Error(
      "backup migration journal is not compatible with the current application",
    );
  }
}
