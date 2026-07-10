import { initializeFirstDeveloper } from "@/ops/bootstrap";
import { writeStructuredLog } from "@/ops/structured-log";

async function main(): Promise<void> {
  const developer = await initializeFirstDeveloper({
    databasePath: process.env.DATABASE_PATH ?? "data/request-manager.db",
    username: process.env.ADMIN_USERNAME ?? "",
    displayName: process.env.ADMIN_DISPLAY_NAME ?? "",
    password: process.env.ADMIN_PASSWORD ?? "",
  });
  writeStructuredLog("first_developer_initialized", {
    developerId: developer.id,
    username: developer.username,
  });
}

void main().catch((error: unknown) => {
  writeStructuredLog(
    "first_developer_initialization_failed",
    {
      errorCode: "FIRST_DEVELOPER_INIT_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    console.error,
  );
  process.exitCode = 1;
});
