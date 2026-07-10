import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/auth/password";
import { closeDatabase, createDatabase } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import { attachments, projects, requests, users } from "@/db/schema";
import { checkAttachmentIntegrity } from "@/ops/attachment-integrity";

const NOW = new Date("2026-07-10T08:00:00.000Z");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("attachment crash reconciliation", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  async function fixture() {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "request-manager-ops-attachments-")),
    );
    cleanups.push(() => rmSync(root, { force: true, recursive: true }));
    const databasePath = join(root, "request-manager.db");
    const uploadsPath = join(root, "uploads");
    const database = createDatabase(databasePath);
    migrateDatabase(database);
    const user = database.db
      .insert(users)
      .values({
        username: "developer",
        displayName: "Developer",
        passwordHash: await hashPassword("developer password"),
        role: "DEVELOPER",
        isActive: true,
        mustChangePassword: false,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning()
      .get();
    const project = database.db
      .insert(projects)
      .values({ code: "OPS", name: "Operations", createdAt: NOW, updatedAt: NOW })
      .returning()
      .get();
    const request = database.db
      .insert(requests)
      .values({
        projectId: project.id,
        createdById: user.id,
        content: "attachment integrity fixture",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: randomUUID(),
        createPayloadFingerprint: "fixture",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning()
      .get();

    const records = [
      { storageName: randomUUID(), expected: Buffer.from("good") },
      { storageName: randomUUID(), expected: Buffer.from("missing") },
      { storageName: randomUUID(), expected: Buffer.from("right size") },
      { storageName: randomUUID(), expected: Buffer.from("right hash") },
    ];
    for (const record of records) {
      database.db
        .insert(attachments)
        .values({
          requestId: request.id,
          uploadedById: user.id,
          storageName: record.storageName,
          originalName: `${record.storageName}.png`,
          mimeType: "image/png",
          sizeBytes: record.expected.length,
          sha256: sha256(record.expected),
          createdAt: NOW,
        })
        .run();
    }
    closeDatabase(database);

    function attachmentPath(storageName: string): string {
      return join(uploadsPath, storageName.slice(0, 2), storageName);
    }
    for (const record of [records[0]!, records[2]!, records[3]!]) {
      mkdirSync(join(uploadsPath, record.storageName.slice(0, 2)), {
        recursive: true,
      });
    }
    writeFileSync(attachmentPath(records[0]!.storageName), records[0]!.expected);
    writeFileSync(attachmentPath(records[2]!.storageName), "wrong size bytes");
    writeFileSync(
      attachmentPath(records[3]!.storageName),
      Buffer.alloc(records[3]!.expected.length, 0x78),
    );

    const orphanName = randomUUID();
    const orphanPath = attachmentPath(orphanName);
    mkdirSync(join(uploadsPath, orphanName.slice(0, 2)), { recursive: true });
    writeFileSync(orphanPath, "crash orphan");

    return { databasePath, uploadsPath, records, orphanName, orphanPath };
  }

  it("reports missing, orphaned, wrong-size and wrong-hash files without mutation", async () => {
    const data = await fixture();

    const report = await checkAttachmentIntegrity({
      databasePath: data.databasePath,
      uploadsPath: data.uploadsPath,
      apply: false,
    });

    expect(report.missing).toEqual([data.records[1]!.storageName]);
    expect(report.orphaned).toEqual([data.orphanName]);
    expect(report.wrongSize).toEqual([data.records[2]!.storageName]);
    expect(report.wrongHash).toEqual([data.records[3]!.storageName]);
    expect(report.removedOrphans).toEqual([]);
    expect(existsSync(data.orphanPath)).toBe(true);
  });

  it("apply removes only confirmed orphans and never changes database records", async () => {
    const data = await fixture();
    const misplacedReferencedFile = join(
      data.uploadsPath,
      data.records[0]!.storageName,
    );
    writeFileSync(misplacedReferencedFile, "misplaced crash artifact");

    const report = await checkAttachmentIntegrity({
      databasePath: data.databasePath,
      uploadsPath: data.uploadsPath,
      apply: true,
    });

    expect(report.removedOrphans).toEqual(
      expect.arrayContaining([data.orphanName, data.records[0]!.storageName]),
    );
    expect(existsSync(data.orphanPath)).toBe(false);
    expect(existsSync(misplacedReferencedFile)).toBe(false);
    const database = createDatabase(data.databasePath);
    try {
      expect(database.db.select().from(attachments).all()).toHaveLength(4);
    } finally {
      closeDatabase(database);
    }
    expect(report.missing).toEqual([data.records[1]!.storageName]);
    expect(
      existsSync(
        join(
          data.uploadsPath,
          data.records[2]!.storageName.slice(0, 2),
          data.records[2]!.storageName,
        ),
      ),
    ).toBe(true);
  });

  it("refuses apply when the database is inside uploads and preserves SQLite files", async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "request-manager-ops-overlap-")),
    );
    cleanups.push(() => rmSync(root, { force: true, recursive: true }));
    const uploadsPath = join(root, "uploads");
    const databasePath = join(uploadsPath, "request-manager.db");
    const database = createDatabase(databasePath);
    migrateDatabase(database);
    closeDatabase(database);
    const walPath = `${databasePath}-wal`;
    const shmPath = `${databasePath}-shm`;
    const orphanPath = join(uploadsPath, "orphan.bin");
    writeFileSync(walPath, "wal sentinel");
    writeFileSync(shmPath, "shm sentinel");
    writeFileSync(orphanPath, "orphan sentinel");

    await expect(
      checkAttachmentIntegrity({ databasePath, uploadsPath, apply: true }),
    ).rejects.toThrow(/independent|overlap/i);

    expect(readFileSync(databasePath).length).toBeGreaterThan(0);
    expect(existsSync(walPath)).toBe(true);
    expect(existsSync(shmPath)).toBe(true);
    expect(existsSync(orphanPath)).toBe(true);
  });

  it("rejects uploads reached through an ancestor symbolic link", async () => {
    const data = await fixture();
    const alias = join(data.uploadsPath, "..", "uploads-alias");
    symlinkSync(data.uploadsPath, alias, "dir");

    await expect(
      checkAttachmentIntegrity({
        databasePath: data.databasePath,
        uploadsPath: alias,
        apply: true,
      }),
    ).rejects.toThrow(/symbolic/i);
    expect(existsSync(data.orphanPath)).toBe(true);
  });
});
