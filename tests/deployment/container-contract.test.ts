import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("deployment container contract", () => {
  test("pins Node 24 and runs RequestManager as a non-root user", () => {
    const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM node:24-");
    expect(dockerfile).toContain("USER request-manager");
    expect(dockerfile).toContain("EXPOSE 13001");
    expect(dockerfile).toContain(
      'CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "13001", "--hostname", "0.0.0.0"]',
    );
  });

  test("never sends runtime data or secrets to Docker", () => {
    const ignored = readFileSync(resolve(root, ".dockerignore"), "utf8");
    const entries = ignored.split(/\r?\n/);

    for (const entry of [
      "data",
      ".env*",
      ".git",
      "node_modules",
      "test-results",
      "playwright-report",
    ]) {
      expect(entries).toContain(entry);
    }
  });
});
