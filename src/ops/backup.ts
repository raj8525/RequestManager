import { randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import Database from "better-sqlite3";

import { closeDatabase, createDatabase } from "@/db/client";
import {
  assertCurrentMigrationJournal,
  getAppliedMigrationJournal,
  type MigrationJournalEntry,
} from "@/db/migrate";
import type { AppDatabase } from "@/db/types";
import {
  inspectRegularFile,
  readBackupManifest,
  type BackupManifest,
  writeBackupManifest,
} from "@/ops/manifest";
import {
  durableRenameManagedTree,
  fsyncDirectory,
  fsyncManagedTree,
  fsyncRegularFile,
  renameAndSyncParents,
} from "@/ops/durability";
import {
  assertIndependentPaths,
  assertSafeManagedFilePath,
  assertSafeManagedPath,
  attachmentRelativePath,
  liveAttachmentPath,
} from "@/ops/paths";
import { acquireDatabaseProcessLock } from "@/ops/process-lock";

type SnapshotAttachment = {
  storageName: string;
  sizeBytes: number;
  sha256: string;
};

export type CreateBackupOptions = {
  databasePath: string;
  uploadsPath: string;
  backupRoot: string;
  now?: Date;
};

export type RestoreBackupOptions = {
  backupPath: string;
  databasePath: string;
  uploadsPath: string;
  confirmed: boolean;
  applicationStopped: boolean;
};

function assertDirectory(path: string, label: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a regular directory`);
  }
}

function mkdirManaged(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertDirectory(path, "managed directory");
}

function backupName(now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `request-manager-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function snapshotAttachments(sqlite: Database.Database): SnapshotAttachment[] {
  return sqlite
    .prepare(
      "select storage_name as storageName, size_bytes as sizeBytes, sha256 from attachments union all select storage_name, size_bytes, sha256 from developer_question_attachments order by storageName",
    )
    .all() as SnapshotAttachment[];
}

function ensureCheckpoint(database: AppDatabase): void {
  const checkpoint = database.sqlite.pragma("wal_checkpoint(FULL)", {
    simple: false,
  }) as Array<{ busy: number; log: number; checkpointed: number }>;
  if (checkpoint[0]?.busy !== 0) {
    throw new Error("SQLite WAL checkpoint could not obtain a consistent boundary");
  }
}

function assertManifestRowsMatchSnapshot(
  manifest: BackupManifest,
  sqlite: Database.Database,
): void {
  const rows = snapshotAttachments(sqlite);
  const expected = manifest.attachments.map((attachment) => ({
    storageName: attachment.storageName,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
  }));
  if (JSON.stringify(rows) !== JSON.stringify(expected)) {
    throw new Error("backup manifest does not match snapshot attachment rows");
  }
  const appliedJournal = getAppliedMigrationJournal(sqlite);
  if (JSON.stringify(appliedJournal) !== JSON.stringify(manifest.migrationJournal)) {
    throw new Error("backup manifest migration journal does not match its database");
  }
  assertCurrentMigrationJournal(appliedJournal);
}

async function verifyManifestFile(
  backupPath: string,
  file: { path: string; sizeBytes: number; sha256: string },
): Promise<void> {
  const inspected = await inspectRegularFile(join(backupPath, file.path));
  if (inspected.sizeBytes !== file.sizeBytes) {
    throw new Error(`backup size mismatch for ${file.path}`);
  }
  if (inspected.sha256 !== file.sha256) {
    throw new Error(`backup SHA-256 digest mismatch for ${file.path}`);
  }
}

function allBackupFiles(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("backup must not contain symbolic links");
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else throw new Error("backup contains an unsupported filesystem entry");
    }
  }
  visit(root);
  return files.sort();
}

export async function verifyBackup(backupPathInput: string): Promise<BackupManifest> {
  const backupPath = assertSafeManagedPath(backupPathInput, "backup directory");
  assertDirectory(backupPath, "backup directory");
  const manifest = readBackupManifest(backupPath);
  await verifyManifestFile(backupPath, manifest.database);
  for (const attachment of manifest.attachments) {
    await verifyManifestFile(backupPath, attachment);
  }

  const expectedFiles = [
    "manifest.json",
    manifest.database.path,
    ...manifest.attachments.map((attachment) => attachment.path),
  ].sort();
  const actualFiles = allBackupFiles(backupPath);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `backup file set does not match its manifest: ${JSON.stringify(actualFiles)}`,
    );
  }

  const snapshot = new Database(join(backupPath, manifest.database.path), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const integrity = snapshot.pragma("integrity_check", { simple: true }) as string;
    if (integrity !== "ok") throw new Error("backup database integrity check failed");
    const foreignKeyFailures = snapshot.pragma("foreign_key_check") as unknown[];
    if (foreignKeyFailures.length > 0) {
      throw new Error("backup database foreign-key check failed");
    }
    assertManifestRowsMatchSnapshot(manifest, snapshot);
  } finally {
    snapshot.close();
  }
  return manifest;
}

export async function createBackup(options: CreateBackupOptions): Promise<{
  backupPath: string;
  manifest: BackupManifest;
}> {
  const databasePath = assertSafeManagedFilePath(
    options.databasePath,
    "database file",
  );
  const uploadsPath = assertSafeManagedPath(options.uploadsPath, "uploads directory");
  const backupRoot = assertSafeManagedPath(options.backupRoot, "backup root");
  assertIndependentPaths(uploadsPath, "uploads directory", backupRoot, "backup root");
  assertIndependentPaths(databasePath, "database file", backupRoot, "backup root");
  assertIndependentPaths(databasePath, "database file", uploadsPath, "uploads directory");
  if (!existsSync(databasePath)) throw new Error("database file does not exist");
  if (existsSync(uploadsPath)) assertDirectory(uploadsPath, "uploads directory");
  mkdirManaged(backupRoot);

  const finalPath = join(backupRoot, backupName(options.now ?? new Date()));
  const partialPath = `${finalPath}.partial`;
  mkdirSync(partialPath, { recursive: false, mode: 0o700 });
  const snapshotPath = join(partialPath, "database.sqlite");
  let database: AppDatabase | null = null;
  try {
    database = createDatabase(databasePath);
    ensureCheckpoint(database);
    await database.sqlite.backup(snapshotPath);
    closeDatabase(database);
    database = null;

    const snapshot = new Database(snapshotPath, { fileMustExist: true });
    let rows: SnapshotAttachment[];
    let migrationJournal: MigrationJournalEntry[];
    try {
      snapshot.pragma("journal_mode = DELETE");
      rows = snapshotAttachments(snapshot);
      migrationJournal = getAppliedMigrationJournal(snapshot);
      assertCurrentMigrationJournal(migrationJournal);
    } finally {
      snapshot.close();
    }

    const manifestAttachments: BackupManifest["attachments"] = [];
    for (const row of rows) {
      const sourcePath = liveAttachmentPath(uploadsPath, row.storageName);
      assertDirectory(dirname(sourcePath), "attachment prefix directory");
      const source = await inspectRegularFile(sourcePath);
      if (source.sizeBytes !== row.sizeBytes || source.sha256 !== row.sha256) {
        throw new Error(
          `live attachment ${row.storageName} does not match its database row`,
        );
      }
      const path = attachmentRelativePath(row.storageName);
      const destinationPath = join(partialPath, path);
      mkdirManaged(dirname(destinationPath));
      copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      const copied = await inspectRegularFile(destinationPath);
      if (copied.sizeBytes !== row.sizeBytes || copied.sha256 !== row.sha256) {
        throw new Error(`copied attachment ${row.storageName} failed verification`);
      }
      manifestAttachments.push({
        storageName: row.storageName,
        path,
        sizeBytes: copied.sizeBytes,
        sha256: copied.sha256,
      });
    }

    const databaseFile = await inspectRegularFile(snapshotPath);
    const manifest: BackupManifest = {
      formatVersion: 2,
      createdAt: (options.now ?? new Date()).toISOString(),
      schemaVersion: migrationJournal.length,
      migrationJournal,
      database: { path: "database.sqlite", ...databaseFile },
      attachments: manifestAttachments,
    };
    writeBackupManifest(partialPath, manifest);
    await verifyBackup(partialPath);
    durableRenameManagedTree(partialPath, finalPath);
    return { backupPath: finalPath, manifest };
  } catch (error) {
    if (database) closeDatabase(database);
    rmSync(partialPath, { force: true, recursive: true });
    throw error;
  }
}

function checkpointStoppedDatabase(databasePath: string): void {
  const sidecarPaths = ["-wal", "-shm"].map(
    (suffix) => `${databasePath}${suffix}`,
  );
  if (!sidecarPaths.some((path) => existsSync(path))) return;
  for (const path of sidecarPaths) {
    if (!existsSync(path)) continue;
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("SQLite sidecars must be regular files before restore");
    }
  }

  const sqlite = new Database(databasePath, { fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 5000");
    const [result] = sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy: number;
      checkpointed: number;
      log: number;
    }>;
    if (!result || result.busy !== 0) {
      throw new Error("SQLite WAL is still in use by another process");
    }
  } finally {
    sqlite.close();
  }

  if (sidecarPaths.some((path) => existsSync(path))) {
    throw new Error(
      "application must be stopped cleanly before restore",
    );
  }
}

function bestEffortRemove(path: string, recursive = false): void {
  try {
    rmSync(path, { force: true, recursive });
    fsyncDirectory(dirname(path));
  } catch {
    // The completed swap remains valid; the recovery copy can be removed manually.
  }
}

function attemptRollback(
  errors: unknown[],
  operation: () => void,
): void {
  try {
    operation();
  } catch (error) {
    errors.push(error);
  }
}

export async function restoreBackup(options: RestoreBackupOptions): Promise<BackupManifest> {
  if (!options.confirmed) throw new Error("restore requires explicit confirmation");
  if (!options.applicationStopped) {
    throw new Error("restore requires acknowledgement that the application is stopped");
  }

  const backupPath = assertSafeManagedPath(options.backupPath, "backup directory");
  const databasePath = assertSafeManagedFilePath(
    options.databasePath,
    "database file",
  );
  const uploadsPath = assertSafeManagedPath(options.uploadsPath, "uploads directory");
  assertIndependentPaths(backupPath, "backup directory", uploadsPath, "uploads directory");
  assertIndependentPaths(backupPath, "backup directory", databasePath, "database file");
  assertIndependentPaths(databasePath, "database file", uploadsPath, "uploads directory");
  const restoreLock = acquireDatabaseProcessLock(databasePath, "restore");
  try {
    checkpointStoppedDatabase(databasePath);
    const manifest = await verifyBackup(backupPath);

    mkdirManaged(dirname(databasePath));
    mkdirManaged(dirname(uploadsPath));
    const operationId = randomUUID();
    const stagedDatabase = join(dirname(databasePath), `.restore-db-${operationId}`);
    const stagedUploads = join(dirname(uploadsPath), `.restore-uploads-${operationId}`);
    const previousDatabase = join(dirname(databasePath), `.previous-db-${operationId}`);
    const previousUploads = join(dirname(uploadsPath), `.previous-uploads-${operationId}`);
    let databaseMoved = false;
    let uploadsMoved = false;
    let databaseInstalled = false;
    let uploadsInstalled = false;

    try {
      copyFileSync(
        join(backupPath, manifest.database.path),
        stagedDatabase,
        constants.COPYFILE_EXCL,
      );
      mkdirSync(stagedUploads, { recursive: false, mode: 0o700 });
      for (const attachment of manifest.attachments) {
        const destination = liveAttachmentPath(
          stagedUploads,
          attachment.storageName,
        );
        mkdirManaged(dirname(destination));
        copyFileSync(
          join(backupPath, attachment.path),
          destination,
          constants.COPYFILE_EXCL,
        );
        const copied = await inspectRegularFile(destination);
        if (
          copied.sizeBytes !== attachment.sizeBytes ||
          copied.sha256 !== attachment.sha256
        ) {
          throw new Error(`staged attachment ${attachment.storageName} failed verification`);
        }
      }
      const stagedDatabaseFile = await inspectRegularFile(stagedDatabase);
      if (
        stagedDatabaseFile.sizeBytes !== manifest.database.sizeBytes ||
        stagedDatabaseFile.sha256 !== manifest.database.sha256
      ) {
        throw new Error("staged database failed SHA-256 verification");
      }
      fsyncRegularFile(stagedDatabase);
      fsyncManagedTree(stagedUploads);

      if (existsSync(databasePath)) {
        renameAndSyncParents(databasePath, previousDatabase);
        databaseMoved = true;
      }
      if (existsSync(uploadsPath)) {
        assertDirectory(uploadsPath, "uploads directory");
        renameAndSyncParents(uploadsPath, previousUploads);
        uploadsMoved = true;
      }
      renameAndSyncParents(stagedDatabase, databasePath);
      databaseInstalled = true;
      renameAndSyncParents(stagedUploads, uploadsPath);
      uploadsInstalled = true;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      if (uploadsInstalled) {
        attemptRollback(rollbackErrors, () => {
          rmSync(uploadsPath, { force: true, recursive: true });
          fsyncDirectory(dirname(uploadsPath));
        });
      }
      if (uploadsMoved) {
        attemptRollback(rollbackErrors, () =>
          renameAndSyncParents(previousUploads, uploadsPath),
        );
      }
      if (databaseInstalled) {
        attemptRollback(rollbackErrors, () => {
          rmSync(databasePath, { force: true });
          fsyncDirectory(dirname(databasePath));
        });
      }
      if (databaseMoved) {
        attemptRollback(rollbackErrors, () =>
          renameAndSyncParents(previousDatabase, databasePath),
        );
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "restore failed and live-path rollback also failed",
        );
      }
      throw error;
    } finally {
      rmSync(stagedDatabase, { force: true });
      rmSync(stagedUploads, { force: true, recursive: true });
      fsyncDirectory(dirname(stagedDatabase));
      if (dirname(stagedUploads) !== dirname(stagedDatabase)) {
        fsyncDirectory(dirname(stagedUploads));
      }
    }
    if (databaseMoved) bestEffortRemove(previousDatabase);
    if (uploadsMoved) bestEffortRemove(previousUploads, true);
    return manifest;
  } finally {
    restoreLock.release();
  }
}
