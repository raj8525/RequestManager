import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3210";
const databasePath = path.resolve(
  process.env.E2E_DATABASE_PATH ?? "data/e2e/request-manager.db",
);
const uploadsPath = path.resolve(
  process.env.E2E_UPLOADS_PATH ?? "data/e2e/uploads",
);
const tempUploadsPath = path.resolve("data/e2e/tmp");
const liveDatabasePath = path.resolve(
  process.env.DATABASE_PATH ?? "data/request-manager.db",
);
const liveUploadsPath = path.resolve(
  process.env.UPLOADS_PATH ?? "data/uploads",
);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-chrome",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npm run e2e:server",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E_BASE_URL: baseURL,
      E2E_DATABASE_PATH: databasePath,
      E2E_UPLOADS_PATH: uploadsPath,
      DATABASE_PATH: databasePath,
      UPLOADS_PATH: uploadsPath,
      TEMP_UPLOADS_PATH: tempUploadsPath,
      LIVE_DATABASE_PATH: liveDatabasePath,
      LIVE_UPLOADS_PATH: liveUploadsPath,
      APP_ORIGIN: baseURL,
      SECURE_COOKIES: "false",
      TRUST_PROXY_HEADERS: "true",
    },
  },
});
