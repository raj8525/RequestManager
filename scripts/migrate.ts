import { closeDatabase, createDatabase } from "@/db/client";
import { getSchemaVersion, migrateDatabase } from "@/db/migrate";
import { assertSafeManagedFilePath } from "@/ops/paths";
import { writeStructuredLog } from "@/ops/structured-log";

async function main(): Promise<void> {
  const databasePath = assertSafeManagedFilePath(
    process.env.DATABASE_PATH ?? "data/request-manager.db",
    "database file",
  );
  const database = createDatabase(databasePath);
  try {
    const beforeVersion = getSchemaVersion(database);
    migrateDatabase(database);
    const afterVersion = getSchemaVersion(database);
    writeStructuredLog("database_migrated", {
      beforeVersion,
      afterVersion,
    });
  } finally {
    closeDatabase(database);
  }
}

void main().catch((error: unknown) => {
  writeStructuredLog(
    "database_migration_failed",
    {
      errorCode: "DATABASE_MIGRATION_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    console.error,
  );
  process.exitCode = 1;
});
