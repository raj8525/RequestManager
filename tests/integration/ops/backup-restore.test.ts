import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/auth/password";
import { closeDatabase, createDatabase } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import { attachments, projects, requests, users } from "@/db/schema";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
} from "@/ops/backup";
import { inspectRegularFile, type BackupManifest } from "@/ops/manifest";
import {
  acquireDatabaseProcessLock,
  databaseProcessLockPath,
} from "@/ops/process-lock";

const NOW = new Date("2026-07-10T08:00:00.000Z");

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("consistent backup and stopped restore", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  function isolatedPaths() {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "request-manager-ops-backup-")),
    );
    cleanups.push(() => rmSync(root, { force: true, recursive: true }));
    return {
      root,
      databasePath: join(root, "live", "request-manager.db"),
      uploadsPath: join(root, "live", "uploads"),
      backupRoot: join(root, "backups"),
    };
  }

  async function seed(paths: ReturnType<typeof isolatedPaths>) {
    const database = createDatabase(paths.databasePath);
    migrateDatabase(database);
    const developer = database.db
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
        createdById: developer.id,
        content: "content captured by backup",
        requestType: "BUG",
        priority: "IMPORTANT",
        idempotencyKey: randomUUID(),
        createPayloadFingerprint: "fixture",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning()
      .get();
    const storageName = randomUUID();
    const bytes = Buffer.from("protected screenshot bytes");
    const attachment = database.db
      .insert(attachments)
      .values({
        requestId: request.id,
        uploadedById: developer.id,
        storageName,
        originalName: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: bytes.length,
        sha256: digest(bytes),
        createdAt: NOW,
      })
      .returning()
      .get();
    const attachmentPath = join(
      paths.uploadsPath,
      storageName.slice(0, 2),
      storageName,
    );
    mkdirSync(join(paths.uploadsPath, storageName.slice(0, 2)), {
      recursive: true,
    });
    writeFileSync(attachmentPath, bytes);

    const orphanName = randomUUID();
    const orphanPath = join(
      paths.uploadsPath,
      orphanName.slice(0, 2),
      orphanName,
    );
    mkdirSync(join(paths.uploadsPath, orphanName.slice(0, 2)), {
      recursive: true,
    });
    writeFileSync(orphanPath, "orphan must not enter backup");
    closeDatabase(database);
    return { request, attachment, attachmentPath, bytes, orphanName };
  }

  it("uses an online SQLite snapshot and includes only snapshot attachment rows", async () => {
    const paths = isolatedPaths();
    const fixture = await seed(paths);

    const result = await createBackup({
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      backupRoot: paths.backupRoot,
      now: NOW,
    });

    expect(result.backupPath.endsWith(".partial")).toBe(false);
    expect(existsSync(`${result.backupPath}.partial`)).toBe(false);
    expect(result.manifest).toMatchObject({
      formatVersion: 2,
      schemaVersion: 4,
      migrationJournal: [
        { ordinal: 0, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { ordinal: 1, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { ordinal: 2, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { ordinal: 3, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ],
      database: { path: "database.sqlite" },
      attachments: [
        {
          storageName: fixture.attachment.storageName,
          sizeBytes: fixture.bytes.length,
          sha256: digest(fixture.bytes),
        },
      ],
    });
    const backupFiles = readdirSync(result.backupPath, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect(backupFiles).not.toContain(fixture.orphanName);
    await expect(verifyBackup(result.backupPath)).resolves.toEqual(result.manifest);
  });

  it("restores the database and protected attachment set after live mutation", async () => {
    const paths = isolatedPaths();
    const fixture = await seed(paths);
    const backup = await createBackup({
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      backupRoot: paths.backupRoot,
      now: NOW,
    });

    const live = createDatabase(paths.databasePath);
    live.db
      .update(requests)
      .set({ content: "mutated after backup" })
      .run();
    closeDatabase(live);
    writeFileSync(fixture.attachmentPath, "mutated attachment");
    writeFileSync(join(paths.uploadsPath, "live-only-file"), "remove on restore");

    await restoreBackup({
      backupPath: backup.backupPath,
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      confirmed: true,
      applicationStopped: true,
    });

    const restored = createDatabase(paths.databasePath);
    try {
      expect(restored.db.select().from(requests).get()?.content).toBe(
        "content captured by backup",
      );
    } finally {
      closeDatabase(restored);
    }
    expect(readFileSync(fixture.attachmentPath)).toEqual(fixture.bytes);
    expect(existsSync(join(paths.uploadsPath, "live-only-file"))).toBe(false);
  });

  it("requires confirmation and stopped-app acknowledgement", async () => {
    const paths = isolatedPaths();
    await seed(paths);
    const backup = await createBackup({
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      backupRoot: paths.backupRoot,
      now: NOW,
    });

    await expect(
      restoreBackup({
        backupPath: backup.backupPath,
        databasePath: paths.databasePath,
        uploadsPath: paths.uploadsPath,
        confirmed: false,
        applicationStopped: true,
      }),
    ).rejects.toThrow(/confirm/i);
    await expect(
      restoreBackup({
        backupPath: backup.backupPath,
        databasePath: paths.databasePath,
        uploadsPath: paths.uploadsPath,
        confirmed: true,
        applicationStopped: false,
      }),
    ).rejects.toThrow(/stopped/i);
  });

  it("verifies every digest before touching live data", async () => {
    const paths = isolatedPaths();
    const fixture = await seed(paths);
    const backup = await createBackup({
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      backupRoot: paths.backupRoot,
      now: NOW,
    });
    const manifest = JSON.parse(
      readFileSync(join(backup.backupPath, "manifest.json"), "utf8"),
    ) as BackupManifest;
    const backedUpAttachment = join(
      backup.backupPath,
      manifest.attachments[0]!.path,
    );
    writeFileSync(
      backedUpAttachment,
      Buffer.alloc(manifest.attachments[0]!.sizeBytes, 0x78),
    );

    const live = createDatabase(paths.databasePath);
    live.db.update(requests).set({ content: "live must survive" }).run();
    closeDatabase(live);
    writeFileSync(fixture.attachmentPath, "live file must survive");

    await expect(
      restoreBackup({
        backupPath: backup.backupPath,
        databasePath: paths.databasePath,
        uploadsPath: paths.uploadsPath,
        confirmed: true,
        applicationStopped: true,
      }),
    ).rejects.toThrow(/digest|sha-?256/i);

    const unchanged = createDatabase(paths.databasePath);
    try {
      expect(unchanged.db.select().from(requests).get()?.content).toBe(
        "live must survive",
      );
    } finally {
      closeDatabase(unchanged);
    }
    expect(readFileSync(fixture.attachmentPath, "utf8")).toBe(
      "live file must survive",
    );
  });

  it("rejects backup roots that contain the live database", async () => {
    const paths = isolatedPaths();
    paths.uploadsPath = join(paths.root, "separate-uploads");
    await seed(paths);

    await expect(
      createBackup({
        databasePath: paths.databasePath,
        uploadsPath: paths.uploadsPath,
        backupRoot: join(paths.root, "live"),
        now: NOW,
      }),
    ).rejects.toThrow(/independent/i);
  });

  it("refuses attachment prefix directories that are symbolic links", async () => {
    const paths = isolatedPaths();
    const fixture = await seed(paths);
    const prefixPath = join(
      paths.uploadsPath,
      fixture.attachment.storageName.slice(0, 2),
    );
    const externalPrefix = join(paths.root, "external-prefix");
    rmSync(prefixPath, { force: true, recursive: true });
    mkdirSync(externalPrefix, { recursive: true });
    writeFileSync(
      join(externalPrefix, fixture.attachment.storageName),
      fixture.bytes,
    );
    symlinkSync(externalPrefix, prefixPath, "dir");

    await expect(
      createBackup({
        databasePath: paths.databasePath,
        uploadsPath: paths.uploadsPath,
        backupRoot: paths.backupRoot,
        now: NOW,
      }),
    ).rejects.toThrow(/symbolic|regular directory/i);
  });

  it("rejects a live database reached through an ancestor symbolic link", async () => {
    const paths = isolatedPaths();
    await seed(paths);
    const liveAlias = join(paths.root, "live-alias");
    symlinkSync(join(paths.root, "live"), liveAlias, "dir");

    await expect(
      createBackup({
        databasePath: join(liveAlias, "request-manager.db"),
        uploadsPath: paths.uploadsPath,
        backupRoot: paths.backupRoot,
        now: NOW,
      }),
    ).rejects.toThrow(/symbolic/i);
  });

  it("rejects restore targets reached through an ancestor symbolic link", async () => {
    const paths = isolatedPaths();
    await seed(paths);
    const backup = await createBackup({
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      backupRoot: paths.backupRoot,
      now: NOW,
    });
    const liveAlias = join(paths.root, "live-alias");
    symlinkSync(join(paths.root, "live"), liveAlias, "dir");

    await expect(
      restoreBackup({
        backupPath: backup.backupPath,
        databasePath: paths.databasePath,
        uploadsPath: join(liveAlias, "uploads"),
        confirmed: true,
        applicationStopped: true,
      }),
    ).rejects.toThrow(/symbolic/i);
  });

  it("rejects a same-length migration journal fork before touching live data", async () => {
    const paths = isolatedPaths();
    await seed(paths);
    const backup = await createBackup({
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      backupRoot: paths.backupRoot,
      now: NOW,
    });
    const snapshotPath = join(backup.backupPath, "database.sqlite");
    const forkedHash = "a".repeat(64);
    const snapshot = new Database(snapshotPath);
    try {
      snapshot
        .prepare(
          "update __drizzle_migrations set hash = ? where rowid = (select min(rowid) from __drizzle_migrations)",
        )
        .run(forkedHash);
    } finally {
      snapshot.close();
    }
    const manifestPath = join(backup.backupPath, "manifest.json");
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as BackupManifest;
    manifest.migrationJournal[0]!.hash = forkedHash;
    manifest.database = {
      path: "database.sqlite",
      ...(await inspectRegularFile(snapshotPath)),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const live = createDatabase(paths.databasePath);
    live.db.update(requests).set({ content: "live migration branch" }).run();
    closeDatabase(live);

    await expect(
      restoreBackup({
        backupPath: backup.backupPath,
        databasePath: paths.databasePath,
        uploadsPath: paths.uploadsPath,
        confirmed: true,
        applicationStopped: true,
      }),
    ).rejects.toThrow(/migration.*(journal|compatible)/i);

    const unchanged = createDatabase(paths.databasePath);
    try {
      expect(unchanged.db.select().from(requests).get()?.content).toBe(
        "live migration branch",
      );
    } finally {
      closeDatabase(unchanged);
    }
  });

  it("holds the restore lock from preflight through replacement", async () => {
    const paths = isolatedPaths();
    await seed(paths);
    const backup = await createBackup({
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      backupRoot: paths.backupRoot,
      now: NOW,
    });
    const applicationLock = acquireDatabaseProcessLock(
      paths.databasePath,
      "application",
    );
    try {
      await expect(
        restoreBackup({
          backupPath: backup.backupPath,
          databasePath: paths.databasePath,
          uploadsPath: paths.uploadsPath,
          confirmed: true,
          applicationStopped: true,
        }),
      ).rejects.toThrow(/lock|running/i);
    } finally {
      applicationLock.release();
    }
    expect(existsSync(databaseProcessLockPath(paths.databasePath))).toBe(false);
  });
});
