import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";

import Database from "better-sqlite3";

import { sha256File } from "@/ops/manifest";
import {
  assertIndependentPaths,
  assertSafeManagedFilePath,
  assertSafeManagedPath,
  liveAttachmentPath,
} from "@/ops/paths";

type AttachmentRow = {
  storageName: string;
  sizeBytes: number;
  sha256: string;
};

export type AttachmentIntegrityReport = {
  missing: string[];
  orphaned: string[];
  wrongSize: string[];
  wrongHash: string[];
  removedOrphans: string[];
};

export type CheckAttachmentIntegrityOptions = {
  databasePath: string;
  uploadsPath: string;
  apply?: boolean;
};

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  const rootStats = lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("uploads path must be a regular directory");
  }
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("uploads directory must not contain symbolic links");
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error("uploads directory contains an unsupported entry");
    }
  }
  visit(root);
  return files.sort();
}

function orphanLabel(uploadsPath: string, path: string): string {
  const pathFromRoot = relative(uploadsPath, path).split(sep).join("/");
  const segments = pathFromRoot.split("/");
  if (
    segments.length === 2 &&
    segments[0] === segments[1]?.slice(0, 2)
  ) {
    return segments[1]!;
  }
  return pathFromRoot;
}

function canonicalStorageName(uploadsPath: string, path: string): string | null {
  const pathFromRoot = relative(uploadsPath, path).split(sep).join("/");
  const segments = pathFromRoot.split("/");
  const storageName = segments.length === 2 ? segments[1] : undefined;
  if (!storageName || segments[0] !== storageName.slice(0, 2)) return null;
  try {
    return liveAttachmentPath(uploadsPath, storageName) === path
      ? storageName
      : null;
  } catch {
    return null;
  }
}

export async function checkAttachmentIntegrity(
  options: CheckAttachmentIntegrityOptions,
): Promise<AttachmentIntegrityReport> {
  const databasePath = assertSafeManagedFilePath(
    options.databasePath,
    "database file",
  );
  const uploadsPath = assertSafeManagedPath(options.uploadsPath, "uploads directory");
  assertIndependentPaths(
    databasePath,
    "database file",
    uploadsPath,
    "uploads directory",
  );
  if (!existsSync(databasePath)) throw new Error("database file does not exist");
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  let rows: AttachmentRow[];
  try {
    rows = sqlite
      .prepare(
        "select storage_name as storageName, size_bytes as sizeBytes, sha256 from attachments order by storage_name",
      )
      .all() as AttachmentRow[];
  } finally {
    sqlite.close();
  }

  const expectedPaths = new Map(
    rows.map((row) => [liveAttachmentPath(uploadsPath, row.storageName), row]),
  );
  const actualFiles = filesBelow(uploadsPath);
  const actualSet = new Set(actualFiles);
  const report: AttachmentIntegrityReport = {
    missing: [],
    orphaned: [],
    wrongSize: [],
    wrongHash: [],
    removedOrphans: [],
  };

  for (const [path, row] of expectedPaths) {
    if (!actualSet.has(path)) {
      report.missing.push(row.storageName);
      continue;
    }
    const stats = lstatSync(path);
    if (stats.size !== row.sizeBytes) {
      report.wrongSize.push(row.storageName);
      continue;
    }
    if ((await sha256File(path)) !== row.sha256) {
      report.wrongHash.push(row.storageName);
    }
  }

  const orphanPaths = actualFiles.filter((path) => !expectedPaths.has(path));
  report.orphaned = orphanPaths.map((path) => orphanLabel(uploadsPath, path));
  if (options.apply && orphanPaths.length > 0) {
    const confirm = new Database(databasePath, { fileMustExist: true });
    try {
      confirm.pragma("busy_timeout = 5000");
      confirm.transaction(() => {
        for (const path of orphanPaths) {
          const label = orphanLabel(uploadsPath, path);
          const storageName = canonicalStorageName(uploadsPath, path);
          const referenced = storageName
            ? confirm
                .prepare("select 1 from attachments where storage_name = ?")
                .get(storageName)
            : undefined;
          if (referenced) continue;
          const stats = lstatSync(path);
          if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new Error("orphan changed type during attachment repair");
          }
          rmSync(path);
          report.removedOrphans.push(label);
        }
      }).immediate();
    } finally {
      confirm.close();
    }
  }
  return report;
}
