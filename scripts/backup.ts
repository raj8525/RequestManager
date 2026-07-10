import { createBackup } from "@/ops/backup";
import { writeStructuredLog } from "@/ops/structured-log";

async function main(): Promise<void> {
  const result = await createBackup({
    databasePath: process.env.DATABASE_PATH ?? "data/request-manager.db",
    uploadsPath: process.env.UPLOADS_PATH ?? "data/uploads",
    backupRoot: process.env.BACKUP_PATH ?? "data/backups",
  });
  writeStructuredLog("backup_completed", {
    backupPath: result.backupPath,
    schemaVersion: result.manifest.schemaVersion,
    attachmentCount: result.manifest.attachments.length,
  });
}

void main().catch((error: unknown) => {
  writeStructuredLog(
    "backup_failed",
    {
      errorCode: "BACKUP_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    console.error,
  );
  process.exitCode = 1;
});
