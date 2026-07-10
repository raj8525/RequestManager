import { createHash } from "node:crypto";
import { createReadStream, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { attachmentRelativePath } from "@/ops/paths";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const storageNameSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const backupFileSchema = z
  .object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  })
  .strict();

export const backupManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    createdAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.number().int().nonnegative(),
    database: backupFileSchema.extend({ path: z.literal("database.sqlite") }),
    attachments: z.array(
      backupFileSchema
        .extend({ storageName: storageNameSchema })
        .superRefine((attachment, context) => {
          if (attachment.path !== attachmentRelativePath(attachment.storageName)) {
            context.addIssue({
              code: "custom",
              message: "attachment manifest path does not match its storage name",
              path: ["path"],
            });
          }
        }),
    ),
  })
  .strict()
  .superRefine((manifest, context) => {
    const names = new Set<string>();
    for (const [index, attachment] of manifest.attachments.entries()) {
      if (names.has(attachment.storageName)) {
        context.addIssue({
          code: "custom",
          message: "attachment storage names must be unique",
          path: ["attachments", index, "storageName"],
        });
      }
      names.add(attachment.storageName);
    }
  });

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function parseBackupManifest(value: unknown): BackupManifest {
  return backupManifestSchema.parse(value);
}

export function readBackupManifest(backupPath: string): BackupManifest {
  const manifestPath = join(backupPath, "manifest.json");
  const stats = lstatSync(manifestPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("backup manifest must be a regular file");
  }
  return parseBackupManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
  );
}

export function writeBackupManifest(
  backupPath: string,
  manifest: BackupManifest,
): void {
  const parsed = parseBackupManifest(manifest);
  writeFileSync(
    join(backupPath, "manifest.json"),
    `${JSON.stringify(parsed, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function inspectRegularFile(path: string): Promise<{
  sizeBytes: number;
  sha256: string;
}> {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("backup data must be a regular file");
  }
  return { sizeBytes: stats.size, sha256: await sha256File(path) };
}
