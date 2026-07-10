import { seedEndToEndData } from "@/ops/e2e-seed";
import { writeStructuredLog } from "@/ops/structured-log";

async function main(): Promise<void> {
  await seedEndToEndData({
    nodeEnvironment: process.env.NODE_ENV,
    databasePath: process.env.E2E_DATABASE_PATH ?? "",
    uploadsPath: process.env.E2E_UPLOADS_PATH ?? "",
    liveDatabasePath: process.env.DATABASE_PATH ?? "data/request-manager.db",
    liveUploadsPath: process.env.UPLOADS_PATH ?? "data/uploads",
    password: process.env.E2E_PASSWORD,
  });
  writeStructuredLog("e2e_data_seeded", {
    databasePath: process.env.E2E_DATABASE_PATH,
    uploadsPath: process.env.E2E_UPLOADS_PATH,
  });
}

void main().catch((error: unknown) => {
  writeStructuredLog(
    "e2e_data_seed_failed",
    {
      errorCode: "E2E_SEED_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    console.error,
  );
  process.exitCode = 1;
});
