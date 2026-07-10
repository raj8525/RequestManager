import {
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGetHandler } from "@/app/api/attachments/[attachmentId]/route";
import { createPutHandler } from "@/app/api/requests/[requestId]/route";
import { createPostHandler } from "@/app/api/requests/route";
import type { AuthenticatedUser } from "@/auth/session-service";
import {
  attachments,
  projectMemberships,
  projects,
  users,
} from "@/db/schema";
import { createRequestWithAttachments } from "@/features/attachments/service";
import type { StoragePaths } from "@/features/attachments/storage";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/../tests/helpers/test-database";
import { fakePngSvg, pngFile, webpFile } from "@/../tests/fixtures/images";

const APP_ORIGIN = "https://requests.example.test";
const NOW = new Date("2026-07-10T00:00:00.000Z");
const MAX_MULTIPART_REQUEST_BYTES = 32 * 1024 * 1024;

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

function createForm(
  projectId: number,
  file: File = pngFile(),
  key = "route-create",
): FormData {
  const form = new FormData();
  form.set("projectId", String(projectId));
  form.set("content", "A sufficiently detailed multipart request body");
  form.set("requestType", "BUG");
  form.set("priority", "NORMAL");
  form.set("idempotencyKey", key);
  form.append("attachments", file);
  return form;
}

function multipartRequest(path: string, method: "POST" | "PUT", body: FormData) {
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers: { origin: APP_ORIGIN },
    body,
  });
}

function rawMultipartBytes(fields: ReadonlyArray<readonly [string, string]>): {
  boundary: string;
  bytes: Uint8Array;
} {
  const boundary = "request-manager-test-boundary";
  const body = fields
    .map(
      ([name, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )
    .join("") + `--${boundary}--\r\n`;
  return { boundary, bytes: new TextEncoder().encode(body) };
}

function streamingMultipartRequest(
  path: string,
  method: "POST" | "PUT",
  boundary: string,
  chunks: readonly Uint8Array[],
  extraHeaders: Record<string, string> = {},
): {
  request: Request;
  pulls: () => number;
  cancelled: () => boolean;
} {
  let chunkIndex = 0;
  let pullCount = 0;
  let wasCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      const chunk = chunks[chunkIndex];
      chunkIndex += 1;
      if (chunk) controller.enqueue(chunk);
      if (chunkIndex >= chunks.length) controller.close();
    },
    cancel() {
      wasCancelled = true;
    },
  });
  const request = new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers: {
      origin: APP_ORIGIN,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...extraHeaders,
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return {
    request,
    pulls: () => pullCount,
    cancelled: () => wasCancelled,
  };
}

describe("multipart request and protected attachment routes", () => {
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
    const root = mkdtempSync(join(tmpdir(), "request-manager-route-files-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    return {
      uploadsPath: join(root, "uploads"),
      temporaryUploadsPath: join(root, "tmp"),
    };
  }

  function externalDirectory(): string {
    const root = mkdtempSync(join(tmpdir(), "request-manager-route-external-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    return root;
  }

  it("accepts same-origin authenticated multipart creation and returns stable JSON", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const handler = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });

    const response = await handler(
      multipartRequest("/api/requests", "POST", createForm(project.id)),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        requestNumber: "REQ-000001",
        version: 1,
        attachments: [{ mimeType: "image/png" }],
      },
    });
  });

  it("rejects an oversized declared POST body before reading its stream", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const handler = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });
    const multipart = rawMultipartBytes([
      ["projectId", String(project.id)],
      ["content", "A sufficiently detailed declared-length request"],
      ["requestType", "BUG"],
      ["priority", "NORMAL"],
      ["idempotencyKey", "declared-post-limit"],
    ]);
    const streamed = streamingMultipartRequest(
      "/api/requests",
      "POST",
      multipart.boundary,
      [multipart.bytes, multipart.bytes],
      {
        "content-length": String(MAX_MULTIPART_REQUEST_BYTES + 1),
      },
    );

    const response = await handler(streamed.request);

    expect(response.status).toBe(413);
    expect(streamed.cancelled()).toBe(true);
    expect(streamed.pulls()).toBeLessThan(2);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "ATTACHMENT_INVALID",
      fieldErrors: { attachments: expect.any(Array) },
    });
  });

  it("rejects an oversized declared PUT body before reading its stream", async () => {
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
        content: "A request created before the declared-length edit",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "declared-put-fixture",
      },
      [],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const handler = createPutHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });
    const multipart = rawMultipartBytes([
      ["expectedVersion", String(created.data.version)],
      ["content", "A sufficiently detailed declared-length edit"],
      ["requestType", "CHANGE"],
      ["priority", "IMPORTANT"],
    ]);
    const streamed = streamingMultipartRequest(
      `/api/requests/${created.data.requestNumber}`,
      "PUT",
      multipart.boundary,
      [multipart.bytes, multipart.bytes],
      {
        "content-length": String(MAX_MULTIPART_REQUEST_BYTES + 1),
      },
    );

    const response = await handler(streamed.request, {
      params: Promise.resolve({ requestId: created.data.requestNumber }),
    });

    expect(response.status).toBe(413);
    expect(streamed.cancelled()).toBe(true);
    expect(streamed.pulls()).toBeLessThan(2);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "ATTACHMENT_INVALID",
    });
  });

  it.each([
    ["chunked body", { "transfer-encoding": "chunked" }],
    ["falsely small Content-Length", { "content-length": "1" }],
  ])("aborts a %s when its actual bytes exceed the limit", async (_case, headers) => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const handler = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const streamed = streamingMultipartRequest(
      "/api/requests",
      "POST",
      "oversized-stream",
      [chunk, chunk, chunk, chunk, chunk, chunk],
      headers,
    );

    const response = await handler(streamed.request);

    expect(response.status).toBe(413);
    expect(streamed.cancelled()).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "ATTACHMENT_INVALID",
    });
  });

  it("limits the total number of multipart fields and files using a bounded copy", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const handler = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });
    const form = createForm(project.id, pngFile(), "too-many-parts");
    for (let index = 0; index < 27; index += 1) {
      form.append("extra", String(index));
    }
    const request = multipartRequest("/api/requests", "POST", form);
    const formDataParser = vi.spyOn(Request.prototype, "formData");

    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(formDataParser).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "ATTACHMENT_INVALID",
    });
  });

  it("allows exactly 32 multipart parts without counting the closing boundary", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const handler = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });
    const form = createForm(project.id, pngFile(), "maximum-parts");
    for (let index = 0; index < 26; index += 1) {
      form.append("extra", String(index));
    }

    const response = await handler(
      multipartRequest("/api/requests", "POST", form),
    );

    expect(response.status).toBe(201);
  });

  it("rejects cross-origin, logged-out and spoofed image submissions", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const authenticated = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });
    const loggedOut = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => null,
    });
    const crossOrigin = new Request(`${APP_ORIGIN}/api/requests`, {
      method: "POST",
      headers: { origin: "https://evil.example.test" },
      body: createForm(project.id),
    });

    const originResponse = await authenticated(crossOrigin);
    expect(originResponse.status).toBe(403);
    await expect(originResponse.json()).resolves.toEqual({
      ok: false,
      code: "INVALID_ORIGIN",
      message: "请求来源无效",
    });

    const authResponse = await loggedOut(
      multipartRequest(
        "/api/requests",
        "POST",
        createForm(project.id, pngFile(), "logged-out"),
      ),
    );
    expect(authResponse.status).toBe(401);
    await expect(authResponse.json()).resolves.toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });

    const imageResponse = await authenticated(
      multipartRequest(
        "/api/requests",
        "POST",
        createForm(project.id, fakePngSvg(), "spoofed"),
      ),
    );
    expect(imageResponse.status).toBe(400);
    await expect(imageResponse.json()).resolves.toMatchObject({
      ok: false,
      code: "ATTACHMENT_INVALID",
      fieldErrors: { attachments: expect.any(Array) },
    });
  });

  it("returns stable failures when session resolution is unavailable", async () => {
    const db = database();
    const paths = storage();
    const project = insertProject(db, "APP");
    const handler = createPostHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => {
        throw new Error("test-only session store failure");
      },
    });

    const response = await handler(
      multipartRequest(
        "/api/requests",
        "POST",
        createForm(project.id, pngFile(), "session-failure"),
      ),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "SYSTEM_UNAVAILABLE",
      message: "系统暂时不可用，请稍后重试",
    });
  });

  it("resolves request numbers and rejects stale or developer multipart edits", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const developer = insertActor(db, "developer", "DEVELOPER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const created = await createRequestWithAttachments(
      db,
      owner,
      {
        projectId: project.id,
        content: "A request created before the multipart edit",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "route-edit",
      },
      [pngFile()],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const editForm = new FormData();
    editForm.set("expectedVersion", "99");
    editForm.set("content", "A stale multipart edit must be rejected");
    editForm.set("requestType", "CHANGE");
    editForm.set("priority", "URGENT");
    editForm.append(
      "retainedAttachmentIds",
      String(created.data.attachments[0]!.id),
    );
    editForm.append("attachments", webpFile());

    const ownerHandler = createPutHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => owner,
    });
    const staleResponse = await ownerHandler(
      multipartRequest(
        `/api/requests/${created.data.requestNumber}`,
        "PUT",
        editForm,
      ),
      { params: Promise.resolve({ requestId: created.data.requestNumber }) },
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      ok: false,
      code: "CONFLICT",
    });

    editForm.set("expectedVersion", "1");
    const developerHandler = createPutHandler({
      database: db,
      storagePaths: paths,
      appOrigin: APP_ORIGIN,
      resolveActor: async () => developer,
    });
    const developerResponse = await developerHandler(
      multipartRequest(
        `/api/requests/${created.data.requestNumber}`,
        "PUT",
        editForm,
      ),
      { params: Promise.resolve({ requestId: created.data.requestNumber }) },
    );
    expect(developerResponse.status).toBe(403);
    await expect(developerResponse.json()).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("streams only currently authorized attachment bytes with nosniff", async () => {
    const db = database();
    const paths = storage();
    const owner = insertActor(db, "owner", "CUSTOMER");
    const project = insertProject(db, "APP");
    assign(db, owner.id, project.id);
    const file = pngFile("protected.png");
    const created = await createRequestWithAttachments(
      db,
      owner,
      {
        projectId: project.id,
        content: "A request whose screenshot is streamed through auth",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "route-read",
      },
      [file],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const attachmentId = created.data.attachments[0]!.id;
    let currentActor: AuthenticatedUser | null = owner;
    const resolveActor = vi.fn(async () => currentActor);
    const handler = createGetHandler({
      database: db,
      storagePaths: paths,
      resolveActor,
    });

    const response = await handler(
      new Request(`${APP_ORIGIN}/api/attachments/${attachmentId}`),
      { params: Promise.resolve({ attachmentId: String(attachmentId) }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from(await file.arrayBuffer()),
    );

    currentActor = null;
    const loggedOut = await handler(
      new Request(`${APP_ORIGIN}/api/attachments/${attachmentId}`),
      { params: Promise.resolve({ attachmentId: String(attachmentId) }) },
    );
    expect(loggedOut.status).toBe(404);

    currentActor = owner;
    db.db
      .delete(projectMemberships)
      .where(
        and(
          eq(projectMemberships.customerId, owner.id),
          eq(projectMemberships.projectId, project.id),
        ),
      )
      .run();
    const revoked = await handler(
      new Request(`${APP_ORIGIN}/api/attachments/${attachmentId}`),
      { params: Promise.resolve({ attachmentId: String(attachmentId) }) },
    );
    expect(revoked.status).toBe(404);
    expect(resolveActor).toHaveBeenCalledTimes(3);
  });

  it("does not read through a symbolic-link upload root", async () => {
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
        content: "A request whose upload root must not be redirected",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "symlink-root-read",
      },
      [pngFile()],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const attachmentId = created.data.attachments[0]!.id;
    const outsideParent = externalDirectory();
    const outsideUploads = join(outsideParent, "uploads");
    renameSync(paths.uploadsPath, outsideUploads);
    symlinkSync(outsideUploads, paths.uploadsPath, "dir");
    const handler = createGetHandler({
      database: db,
      storagePaths: paths,
      resolveActor: async () => owner,
    });

    const response = await handler(
      new Request(`${APP_ORIGIN}/api/attachments/${attachmentId}`),
      { params: Promise.resolve({ attachmentId: String(attachmentId) }) },
    );

    expect(response.status).toBe(404);
  });

  it("does not read through a symbolic-link upload prefix", async () => {
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
        content: "A request whose upload prefix must not be redirected",
        requestType: "BUG",
        priority: "NORMAL",
        idempotencyKey: "symlink-prefix-read",
      },
      [pngFile()],
      paths,
    );
    if (!created.ok) throw new Error(`creation failed: ${created.code}`);
    const attachmentId = created.data.attachments[0]!.id;
    const storageName = db.db
      .select({ storageName: attachments.storageName })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .get()!.storageName;
    const prefixPath = join(paths.uploadsPath, storageName.slice(0, 2));
    const outsideParent = externalDirectory();
    const outsidePrefix = join(outsideParent, "prefix");
    renameSync(prefixPath, outsidePrefix);
    symlinkSync(outsidePrefix, prefixPath, "dir");
    const handler = createGetHandler({
      database: db,
      storagePaths: paths,
      resolveActor: async () => owner,
    });

    const response = await handler(
      new Request(`${APP_ORIGIN}/api/attachments/${attachmentId}`),
      { params: Promise.resolve({ attachmentId: String(attachmentId) }) },
    );

    expect(response.status).toBe(404);
  });
});
