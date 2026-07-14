import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  attachments,
  projectMemberships,
  projects,
  requestEvents,
  requests,
  users,
} from "@/db/schema";
import { getAuthorizedAttachment } from "@/features/attachments/authorization";
import {
  createRequestWithAttachments,
  editRequestWithAttachments,
} from "@/features/attachments/service";
import {
  commitStagedAttachments,
  discardStagedAttachments,
  resolveCommittedAttachmentPath,
  stageAttachments,
  type StoragePaths,
} from "@/features/attachments/storage";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/../tests/helpers/test-database";
import { jpegFile, pngFile, webpFile } from "@/../tests/fixtures/images";

const NOW = new Date("2026-07-10T00:00:00.000Z");

function insertActor(
  database: TestDatabase,
  username: string,
  role: "CUSTOMER" | "DEVELOPER",
): AuthenticatedUser {
  const user = database.db
    .insert(users)
    .values({
      username,
      displayName: username,
      passwordHash: "test-only-hash",
      role,
      isActive: true,
      mustChangePassword: false,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
  return { ...user, mustChangePassword: false };
}

function insertProject(database: TestDatabase, code: string) {
  return database.db
    .insert(projects)
    .values({
      code,
      name: `${code} project`,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
}

function assign(
  database: TestDatabase,
  customerId: number,
  projectId: number,
): void {
  database.db
    .insert(projectMemberships)
    .values({ customerId, projectId, createdAt: NOW })
    .run();
}

function allFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("protected attachment pipeline", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    vi.restoreAllMocks();
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  function database(): TestDatabase {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    return database;
  }

  function storage(): StoragePaths {
    const root = mkdtempSync(join(tmpdir(), "request-manager-files-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    return {
      uploadsPath: join(root, "uploads"),
      temporaryUploadsPath: join(root, "tmp"),
    };
  }

  function externalDirectory(): string {
    const root = mkdtempSync(join(tmpdir(), "request-manager-external-files-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    return root;
  }

  it("stages by random name, hashes content and atomically commits below uploads", async () => {
    const paths = storage();
    const file = pngFile("../../public/evil.png");
    const staged = await stageAttachments([file], paths);

    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      originalName: "../../public/evil.png",
      mimeType: "image/png",
      sizeBytes: file.size,
    });
    expect(staged[0]?.storageName).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(staged[0]?.sha256).toBe(
      createHash("sha256")
        .update(Buffer.from(await file.arrayBuffer()))
        .digest("hex"),
    );
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(1);
    expect(allFiles(paths.uploadsPath)).toHaveLength(0);

    const committed = commitStagedAttachments(staged, paths);
    const expectedPath = resolveCommittedAttachmentPath(
      committed[0]!.storageName,
      paths,
    );
    expect(committed[0]?.path).toBe(expectedPath);
    expect(expectedPath).toContain(
      join("uploads", committed[0]!.storageName.slice(0, 2)),
    );
    expect(readFileSync(expectedPath)).toEqual(
      Buffer.from(await file.arrayBuffer()),
    );
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);
    expect(expectedPath).not.toContain("public");

    expect(() =>
      resolveCommittedAttachmentPath("../../public/evil.png", paths),
    ).toThrow(expect.objectContaining({ code: "ATTACHMENT_INVALID" }));
  });

  it("cleans already staged files when a later file is invalid", async () => {
    const paths = storage();
    const invalid = new File(["<svg/>"] , "bad.png", { type: "image/png" });

    await expect(
      stageAttachments([pngFile("good.png"), invalid], paths),
    ).rejects.toMatchObject({ code: "ATTACHMENT_INVALID" });
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);
  });

  it("fails closed when the temporary upload root is a symbolic link", async () => {
    const paths = storage();
    const external = externalDirectory();
    symlinkSync(external, paths.temporaryUploadsPath, "dir");

    await expect(stageAttachments([pngFile()], paths)).rejects.toMatchObject({
      code: "ATTACHMENT_INVALID",
    });
    expect(allFiles(external)).toHaveLength(0);
  });

  it("fails closed when the committed upload root is a symbolic link", async () => {
    const paths = storage();
    const external = externalDirectory();
    const staged = await stageAttachments([pngFile()], paths);
    symlinkSync(external, paths.uploadsPath, "dir");

    expect(() => commitStagedAttachments(staged, paths)).toThrow(
      expect.objectContaining({ code: "ATTACHMENT_INVALID" }),
    );
    expect(allFiles(external)).toHaveLength(0);
  });

  it("fails closed when an upload prefix directory is a symbolic link", async () => {
    const paths = storage();
    const external = externalDirectory();
    const staged = await stageAttachments([pngFile()], paths);
    mkdirSync(paths.uploadsPath, { recursive: true });
    symlinkSync(
      external,
      join(paths.uploadsPath, staged[0]!.storageName.slice(0, 2)),
      "dir",
    );

    expect(() => commitStagedAttachments(staged, paths)).toThrow(
      expect.objectContaining({ code: "ATTACHMENT_INVALID" }),
    );
    expect(allFiles(external)).toHaveLength(0);
  });

  it("can explicitly discard staged files without touching committed storage", async () => {
    const paths = storage();
    const staged = await stageAttachments([pngFile()], paths);
    await discardStagedAttachments(staged, paths);
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);
    expect(allFiles(paths.uploadsPath)).toHaveLength(0);
  });

  it("creates request rows and files once for an immutable idempotency payload", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const input = {
      projectId: project.id,
      title: "Request with screenshots",
      content: "A sufficiently detailed request with screenshots",
      requestType: "BUG" as const,
      priority: "NORMAL" as const,
      idempotencyKey: "attachment-create-once",
    };

    const first = await createRequestWithAttachments(
      db,
      owner,
      input,
      [pngFile()],
      paths,
    );
    const replay = await createRequestWithAttachments(
      db,
      owner,
      input,
      [pngFile()],
      paths,
    );

    expect(first).toMatchObject({
      ok: true,
      data: { version: 1, attachments: [{ mimeType: "image/png" }] },
    });
    expect(replay).toMatchObject({ ok: true });
    if (!first.ok || !replay.ok) throw new Error("fixture creation failed");
    expect(replay.data.id).toBe(first.data.id);
    expect(replay.data.attachments[0]?.id).toBe(first.data.attachments[0]?.id);
    expect(first.data.attachments[0]).not.toHaveProperty("storageName");
    expect(first.data.attachments[0]).not.toHaveProperty("sha256");
    expect(first.data.attachments[0]).not.toHaveProperty("uploadedById");
    expect(db.db.select().from(requests).all()).toHaveLength(1);
    expect(db.db.select().from(attachments).all()).toHaveLength(1);
    expect(allFiles(paths.uploadsPath)).toHaveLength(1);
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);

    await expect(
      createRequestWithAttachments(db, owner, input, [jpegFile()], paths),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });
    expect(db.db.select().from(attachments).all()).toHaveLength(1);
    expect(allFiles(paths.uploadsPath)).toHaveLength(1);
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);
  });

  it("keeps the original attachment create fingerprint after later edits", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const input = {
      projectId: project.id,
      title: "Original screenshot request",
      content: "The original sufficiently detailed screenshot request",
      requestType: "BUG" as const,
      priority: "NORMAL" as const,
      idempotencyKey: "immutable-attachment-payload",
    };
    const created = await createRequestWithAttachments(
      db,
      owner,
      input,
      [pngFile()],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const fingerprint = db.db
      .select({ value: requests.createPayloadFingerprint })
      .from(requests)
      .where(eq(requests.id, created.data.id))
      .get()!.value;

    const edited = await editRequestWithAttachments(
      db,
      owner,
      {
        requestId: created.data.id,
        expectedVersion: 1,
        title: "Edited screenshot request",
        content: "The edited and still sufficiently detailed screenshot request",
        requestType: "CHANGE",
        priority: "URGENT",
        retainedAttachmentIds: [],
      },
      [webpFile()],
      paths,
    );
    expect(edited).toMatchObject({ ok: true, data: { version: 2 } });
    expect(
      db.db
        .select({ value: requests.createPayloadFingerprint })
        .from(requests)
        .where(eq(requests.id, created.data.id))
        .get()!.value,
    ).toBe(fingerprint);

    const replay = await createRequestWithAttachments(
      db,
      owner,
      input,
      [pngFile()],
      paths,
    );
    expect(replay).toMatchObject({
      ok: true,
      data: {
        id: created.data.id,
        version: 2,
        content: "The edited and still sufficiently detailed screenshot request",
        attachments: [{ mimeType: "image/webp" }],
      },
    });
  });

  it("rolls back the database and committed files when attachment insertion fails", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    db.sqlite.exec(`
      CREATE TRIGGER reject_attachment_insert
      BEFORE INSERT ON attachments
      BEGIN
        SELECT RAISE(ABORT, 'test attachment failure');
      END;
    `);

    await expect(
      createRequestWithAttachments(
        db,
        owner,
        {
          projectId: project.id,
          title: "Rollback attachment request",
          content: "A request that must be rolled back completely",
          requestType: "BUG",
          priority: "NORMAL",
          idempotencyKey: "rollback-files",
        },
        [pngFile()],
        paths,
      ),
    ).resolves.toMatchObject({ ok: false, code: "SYSTEM_UNAVAILABLE" });
    expect(db.db.select().from(requests).all()).toHaveLength(0);
    expect(db.db.select().from(requestEvents).all()).toHaveLength(0);
    expect(allFiles(paths.uploadsPath)).toHaveLength(0);
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);
  });

  it("does not delete committed files when response presentation fails after commit", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    let failReads = false;
    db.sqlite.function("fail_followup_reads", () => {
      failReads = true;
      return 1;
    });
    db.sqlite.exec(`
      CREATE TRIGGER fail_reads_after_attachment_insert
      AFTER INSERT ON attachments
      BEGIN
        SELECT fail_followup_reads();
      END;
    `);
    const originalSelect = db.db.select.bind(db.db);
    db.db.select = ((...args: Parameters<typeof db.db.select>) => {
      if (failReads) throw new Error("test-only presentation failure");
      return originalSelect(...args);
    }) as typeof db.db.select;

    const result = await createRequestWithAttachments(
      db,
      owner,
      {
        projectId: project.id,
        title: "Committed attachment request",
        content: "A committed request whose response query fails",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "post-commit-presentation",
      },
      [pngFile()],
      paths,
    );

    expect(result).toMatchObject({ ok: false, code: "SYSTEM_UNAVAILABLE" });
    failReads = false;
    expect(db.db.select().from(requests).all()).toHaveLength(1);
    expect(db.db.select().from(attachments).all()).toHaveLength(1);
    expect(allFiles(paths.uploadsPath)).toHaveLength(1);
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);
  });

  it("edits body and attachment rows together, then removes deleted files", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const created = await createRequestWithAttachments(
      db,
      owner,
      {
        projectId: project.id,
        title: "Two screenshot request",
        content: "A request with two initial screenshots",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "edit-attachments",
      },
      [pngFile("keep.png"), jpegFile("remove.jpg")],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const [kept, removed] = created.data.attachments;
    const removedStorageName = db.db
      .select({ storageName: attachments.storageName })
      .from(attachments)
      .where(eq(attachments.id, removed!.id))
      .get()!.storageName;
    const removedPath = resolveCommittedAttachmentPath(removedStorageName, paths);

    const edited = await editRequestWithAttachments(
      db,
      owner,
      {
        requestId: created.data.id,
        expectedVersion: created.data.version,
        title: "Changed screenshot request",
        content: "The body and screenshot set changed atomically",
        requestType: "CHANGE",
        priority: "IMPORTANT",
        retainedAttachmentIds: [kept!.id],
      },
      [webpFile("new.webp")],
      paths,
    );

    expect(edited).toMatchObject({
      ok: true,
      data: {
        version: 2,
        content: "The body and screenshot set changed atomically",
        attachments: [
          { id: kept!.id, mimeType: "image/png" },
          { mimeType: "image/webp" },
        ],
      },
    });
    expect(existsSync(removedPath)).toBe(false);
    expect(allFiles(paths.uploadsPath)).toHaveLength(2);
    expect(db.db.select().from(attachments).all()).toHaveLength(2);
    expect(
      db.db
        .select({ type: requestEvents.eventType })
        .from(requestEvents)
        .where(eq(requestEvents.requestId, created.data.id))
        .all()
        .map((event) => event.type),
    ).toEqual([
      "REQUEST_CREATED",
      "ATTACHMENT_ADDED",
      "ATTACHMENT_ADDED",
      "REQUEST_UPDATED",
      "ATTACHMENT_REMOVED",
      "ATTACHMENT_ADDED",
    ]);
  });

  it("cleans new files and preserves rows on stale, IDOR and developer edits", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const peer = insertActor(db, "peer", "CUSTOMER");
    const outsider = insertActor(db, "outsider", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const project = insertProject(db, "APP");
    const otherProject = insertProject(db, "OTHER");
    assign(db, owner.id, project.id);
    assign(db, peer.id, project.id);
    assign(db, outsider.id, otherProject.id);
    const created = await createRequestWithAttachments(
      db,
      owner,
      {
        projectId: project.id,
        title: "Protected edit request",
        content: "A request protected from stale and foreign edits",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "protected-edits",
      },
      [pngFile()],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const retainedAttachmentIds = created.data.attachments.map(({ id }) => id);
    const edit = {
      requestId: created.data.id,
      expectedVersion: 99,
      title: "Invalid edit title",
      content: "This invalid edit must not alter any stored data",
      requestType: "CHANGE" as const,
      priority: "URGENT" as const,
      retainedAttachmentIds,
    };

    await expect(
      editRequestWithAttachments(db, owner, edit, [jpegFile()], paths),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });
    await expect(
      editRequestWithAttachments(db, peer, edit, [jpegFile()], paths),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      editRequestWithAttachments(
        db,
        peer,
        { ...edit, expectedVersion: 1 },
        [jpegFile()],
        paths,
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      editRequestWithAttachments(
        db,
        outsider,
        { ...edit, expectedVersion: 1 },
        [jpegFile()],
        paths,
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(
      editRequestWithAttachments(
        db,
        developer,
        { ...edit, expectedVersion: 1 },
        [jpegFile()],
        paths,
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(db.db.select().from(requests).get()).toMatchObject({ version: 1 });
    expect(db.db.select().from(attachments).all()).toHaveLength(1);
    expect(allFiles(paths.uploadsPath)).toHaveLength(1);
    expect(allFiles(paths.temporaryUploadsPath)).toHaveLength(0);
  });

  it("authorizes every attachment lookup against the live actor and membership", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const peer = insertActor(db, "peer", "CUSTOMER");
    const outsider = insertActor(db, "outsider", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const project = insertProject(db, "APP");
    const otherProject = insertProject(db, "OTHER");
    assign(db, owner.id, project.id);
    assign(db, peer.id, project.id);
    assign(db, outsider.id, otherProject.id);
    const created = await createRequestWithAttachments(
      db,
      owner,
      {
        projectId: project.id,
        title: "Authorized screenshot request",
        content: "A request with an authorization protected screenshot",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "authorized-read",
      },
      [pngFile()],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const attachmentId = created.data.attachments[0]!.id;

    expect(getAuthorizedAttachment(db, owner, attachmentId)?.id).toBe(attachmentId);
    expect(getAuthorizedAttachment(db, peer, attachmentId)?.id).toBe(attachmentId);
    expect(getAuthorizedAttachment(db, developer, attachmentId)?.id).toBe(
      attachmentId,
    );
    expect(getAuthorizedAttachment(db, outsider, attachmentId)).toBeNull();

    db.db
      .delete(projectMemberships)
      .where(
        and(
          eq(projectMemberships.customerId, owner.id),
          eq(projectMemberships.projectId, project.id),
        ),
      )
      .run();
    expect(getAuthorizedAttachment(db, owner, attachmentId)).toBeNull();

    db.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, developer.id))
      .run();
    expect(getAuthorizedAttachment(db, developer, attachmentId)).toBeNull();
  });
});
