import { restoreBackup } from "@/ops/backup";
import { writeStructuredLog } from "@/ops/structured-log";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const backupPath = args.find((arg) => !arg.startsWith("--"));
  if (!backupPath) throw new Error("backup directory argument is required");
  const manifest = await restoreBackup({
    backupPath,
    databasePath: process.env.DATABASE_PATH ?? "data/request-manager.db",
    uploadsPath: process.env.UPLOADS_PATH ?? "data/uploads",
    confirmed: args.includes("--confirm-restore"),
    applicationStopped: args.includes("--app-stopped"),
  });
  writeStructuredLog("restore_completed", {
    schemaVersion: manifest.schemaVersion,
    attachmentCount: manifest.attachments.length,
  });
}

void main().catch((error: unknown) => {
  writeStructuredLog(
    "restore_failed",
    {
      errorCode: "RESTORE_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    console.error,
  );
  process.exitCode = 1;
});
