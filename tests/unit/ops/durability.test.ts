import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { durableRenameManagedTree } from "@/ops/durability";

describe("filesystem durability boundary", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it("fsyncs every file and directory before publishing a managed tree", () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "request-manager-durability-")),
    );
    cleanups.push(() => rmSync(root, { force: true, recursive: true }));
    const source = join(root, "backup.partial");
    const target = join(root, "backup");
    mkdirSync(join(source, "attachments"), { recursive: true });
    writeFileSync(join(source, "database.sqlite"), "database");
    writeFileSync(join(source, "attachments", "image"), "image");

    const report = durableRenameManagedTree(source, target);

    expect(report).toEqual({ filesSynced: 2, directoriesSynced: 2 });
    expect(readFileSync(join(target, "database.sqlite"), "utf8")).toBe(
      "database",
    );
  });
});
