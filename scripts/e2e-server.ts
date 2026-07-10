import { spawn } from "node:child_process";
import path from "node:path";

import { seedEndToEndData } from "@/ops/e2e-seed";

async function main(): Promise<void> {
  const baseURL = new URL(
    process.env.E2E_BASE_URL ?? "http://127.0.0.1:3210",
  );
  const databasePath = path.resolve(
    process.env.E2E_DATABASE_PATH ?? "data/e2e/request-manager.db",
  );
  const uploadsPath = path.resolve(
    process.env.E2E_UPLOADS_PATH ?? "data/e2e/uploads",
  );

  await seedEndToEndData({
    nodeEnvironment: "test",
    databasePath,
    uploadsPath,
    liveDatabasePath: path.resolve(
      process.env.LIVE_DATABASE_PATH ?? "data/request-manager.db",
    ),
    liveUploadsPath: path.resolve(
      process.env.LIVE_UPLOADS_PATH ?? "data/uploads",
    ),
    password: process.env.E2E_PASSWORD ?? "e2e secure password",
  });

  const child = spawn(
    path.resolve("node_modules/.bin/next"),
    [
      "dev",
      "--hostname",
      baseURL.hostname,
      "--port",
      baseURL.port || "80",
    ],
    {
      env: { ...process.env, NODE_ENV: "development" },
      stdio: "inherit",
    },
  );

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
  process.exitCode = exitCode;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "E2E server failed");
  process.exitCode = 1;
});
