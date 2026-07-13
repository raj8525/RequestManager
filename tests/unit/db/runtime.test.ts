import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("runtime database singleton", () => {
  it("stores the connection on the process shared by Next.js server contexts", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../../src/db/runtime.ts"),
      "utf8",
    );

    expect(source).toContain("const runtimeProcess = process as RuntimeProcess");
    expect(source).not.toContain("globalThis as RuntimeGlobal");
  });
});
