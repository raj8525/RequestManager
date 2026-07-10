import { checkAttachmentIntegrity } from "@/ops/attachment-integrity";
import { writeStructuredLog } from "@/ops/structured-log";

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  const report = await checkAttachmentIntegrity({
    databasePath: process.env.DATABASE_PATH ?? "data/request-manager.db",
    uploadsPath: process.env.UPLOADS_PATH ?? "data/uploads",
    apply,
  });
  writeStructuredLog("attachment_integrity_checked", {
    apply,
    missing: report.missing,
    orphaned: report.orphaned,
    wrongSize: report.wrongSize,
    wrongHash: report.wrongHash,
    removedOrphans: report.removedOrphans,
  });
}

void main().catch((error: unknown) => {
  writeStructuredLog(
    "attachment_integrity_check_failed",
    {
      errorCode: "ATTACHMENT_INTEGRITY_CHECK_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    console.error,
  );
  process.exitCode = 1;
});
