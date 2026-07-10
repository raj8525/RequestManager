import { randomUUID } from "node:crypto";
import {
  mkdirSync,
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

function resolveTemporaryAttachmentPath(
  storageName: string,
  paths: StoragePaths,
): string {
  assertStorageName(storageName);
  return resolve(paths.temporaryUploadsPath, storageName);
}

export function resolveCommittedAttachmentPath(
  storageName: string,
  paths: StoragePaths,
): string {
  assertStorageName(storageName);
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
  mkdirSync(resolve(paths.temporaryUploadsPath), {
    recursive: true,
    mode: 0o700,
  });

  const staged: StagedAttachment[] = [];
  const allocatedNames: string[] = [];
  try {
    for (const file of files) {
      const validated = await validateImageFile(file);
      const storageName = randomUUID();
      allocatedNames.push(storageName);
      writeFileSync(
        resolveTemporaryAttachmentPath(storageName, paths),
        validated.bytes,
        { flag: "wx", mode: 0o600 },
      );
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
      const committedPath = resolveCommittedAttachmentPath(
        attachment.storageName,
        paths,
      );
      mkdirSync(resolve(paths.uploadsPath, attachment.storageName.slice(0, 2)), {
        recursive: true,
        mode: 0o700,
      });
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
