import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { getEnvironment } from "@/lib/env";
import { DomainError } from "@/lib/domain-error";

import {
  validateAttachmentLimits,
  validateImageFile,
  type ValidatedImageFile,
} from "./validation";

const STORAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type StoragePaths = {
  uploadsPath: string;
  temporaryUploadsPath: string;
};

export type StagedAttachment = Omit<ValidatedImageFile, "bytes"> & {
  storageName: string;
};

export type CommittedAttachment = StagedAttachment & {
  path: string;
};

export type StoredAttachmentReference = {
  storageName: string;
};

export type StorageCleanupFailure = {
  storageName: string;
  error: unknown;
};

export function storagePathsFromEnvironment(): StoragePaths {
  const environment = getEnvironment();
  return {
    uploadsPath: environment.uploadsPath,
    temporaryUploadsPath: environment.temporaryUploadsPath,
  };
}

function assertStorageName(storageName: string): void {
  if (!STORAGE_NAME_PATTERN.test(storageName)) {
    throw new DomainError("ATTACHMENT_INVALID", "附件存储标识无效");
  }
}

function invalidStorageDirectory(): DomainError {
  return new DomainError("ATTACHMENT_INVALID", "附件存储目录无效", {
    attachments: ["附件存储目录无效"],
  });
}

function assertSafeDirectory(path: string): boolean {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw invalidStorageDirectory();
    }
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function ensureSafeDirectory(path: string, recursive: boolean): void {
  if (!assertSafeDirectory(path)) {
    try {
      mkdirSync(path, { recursive, mode: 0o700 });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
      ) {
        throw error;
      }
    }
  }
  assertSafeDirectory(path);
}

function assertTemporaryStorageSegments(paths: StoragePaths): void {
  assertSafeDirectory(resolve(paths.temporaryUploadsPath));
}

function assertCommittedStorageSegments(
  storageName: string,
  paths: StoragePaths,
): void {
  const uploadsPath = resolve(paths.uploadsPath);
  assertSafeDirectory(uploadsPath);
  assertSafeDirectory(resolve(uploadsPath, storageName.slice(0, 2)));
}

function resolveTemporaryAttachmentPath(
  storageName: string,
  paths: StoragePaths,
): string {
  assertStorageName(storageName);
  assertTemporaryStorageSegments(paths);
  return resolve(paths.temporaryUploadsPath, storageName);
}

export function resolveCommittedAttachmentPath(
  storageName: string,
  paths: StoragePaths,
): string {
  assertStorageName(storageName);
  assertCommittedStorageSegments(storageName, paths);
  return resolve(paths.uploadsPath, storageName.slice(0, 2), storageName);
}

function removePath(
  path: string,
  storageName: string,
): StorageCleanupFailure | null {
  try {
    rmSync(path, { force: true });
    return null;
  } catch (error) {
    return { storageName, error };
  }
}

export async function stageAttachments(
  files: File[],
  paths: StoragePaths,
): Promise<StagedAttachment[]> {
  validateAttachmentLimits(files.map((file) => ({ sizeBytes: file.size })));
  ensureSafeDirectory(resolve(paths.temporaryUploadsPath), true);

  const staged: StagedAttachment[] = [];
  const allocatedNames: string[] = [];
  try {
    for (const file of files) {
      const validated = await validateImageFile(file);
      const storageName = randomUUID();
      allocatedNames.push(storageName);
      ensureSafeDirectory(resolve(paths.temporaryUploadsPath), true);
      const descriptor = openSync(
        resolveTemporaryAttachmentPath(storageName, paths),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(descriptor, validated.bytes);
      } finally {
        closeSync(descriptor);
      }
      staged.push({
        storageName,
        originalName: validated.originalName,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
      });
    }
    return staged;
  } catch (error) {
    for (const storageName of allocatedNames) {
      removePath(resolveTemporaryAttachmentPath(storageName, paths), storageName);
    }
    throw error;
  }
}

export function commitStagedAttachments(
  staged: readonly StagedAttachment[],
  paths: StoragePaths,
): CommittedAttachment[] {
  const committed: CommittedAttachment[] = [];
  try {
    for (const attachment of staged) {
      const temporaryPath = resolveTemporaryAttachmentPath(
        attachment.storageName,
        paths,
      );
      const uploadsPath = resolve(paths.uploadsPath);
      ensureSafeDirectory(uploadsPath, true);
      ensureSafeDirectory(
        resolve(uploadsPath, attachment.storageName.slice(0, 2)),
        false,
      );
      const committedPath = resolveCommittedAttachmentPath(
        attachment.storageName,
        paths,
      );
      assertTemporaryStorageSegments(paths);
      assertCommittedStorageSegments(attachment.storageName, paths);
      renameSync(temporaryPath, committedPath);
      committed.push({ ...attachment, path: committedPath });
    }
    return committed;
  } catch (error) {
    removeCommittedAttachments(committed, paths);
    throw error;
  }
}

export function discardStagedAttachments(
  staged: readonly StagedAttachment[],
  paths: StoragePaths,
): StorageCleanupFailure[] {
  return staged.flatMap((attachment) => {
    const failure = removePath(
      resolveTemporaryAttachmentPath(attachment.storageName, paths),
      attachment.storageName,
    );
    return failure ? [failure] : [];
  });
}

export function removeCommittedAttachments(
  attachments: readonly StoredAttachmentReference[],
  paths: StoragePaths,
): StorageCleanupFailure[] {
  return attachments.flatMap((attachment) => {
    let path: string;
    try {
      path = resolveCommittedAttachmentPath(attachment.storageName, paths);
    } catch (error) {
      return [{ storageName: attachment.storageName, error }];
    }
    const failure = removePath(path, attachment.storageName);
    return failure ? [failure] : [];
  });
}
