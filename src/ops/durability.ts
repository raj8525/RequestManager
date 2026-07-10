import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export type DurabilityReport = {
  filesSynced: number;
  directoriesSynced: number;
};

function syncDescriptor(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function fsyncRegularFile(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("durability boundary requires a regular file");
  }
  syncDescriptor(path);
}

export function fsyncDirectory(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("durability boundary requires a regular directory");
  }
  syncDescriptor(path);
}

export function fsyncManagedTree(root: string): DurabilityReport {
  const report: DurabilityReport = { filesSynced: 0, directoriesSynced: 0 };

  function visit(path: string): void {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new Error("managed tree must not contain symbolic links");
    }
    if (stats.isFile()) {
      fsyncRegularFile(path);
      report.filesSynced += 1;
      return;
    }
    if (!stats.isDirectory()) {
      throw new Error("managed tree contains an unsupported filesystem entry");
    }
    for (const name of readdirSync(path)) visit(join(path, name));
    fsyncDirectory(path);
    report.directoriesSynced += 1;
  }

  visit(root);
  return report;
}

export function renameAndSyncParents(source: string, target: string): void {
  const sourceParent = resolve(dirname(source));
  const targetParent = resolve(dirname(target));
  renameSync(source, target);
  fsyncDirectory(sourceParent);
  if (targetParent !== sourceParent) fsyncDirectory(targetParent);
}

export function durableRenameManagedTree(
  source: string,
  target: string,
): DurabilityReport {
  const report = fsyncManagedTree(source);
  renameAndSyncParents(source, target);
  return report;
}
