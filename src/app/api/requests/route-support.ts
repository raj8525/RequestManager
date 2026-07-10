import type { AuthenticatedUser } from "@/auth/session-service";
import type { AppDatabase } from "@/db/types";
import type { StoragePaths } from "@/features/attachments/storage";
import type { ActionFailure, ActionResult } from "@/lib/action-result";

export const MAX_MULTIPART_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_MULTIPART_PARTS = 32;

class MultipartLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipartLimitError";
  }
}

async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
  reason: string,
): Promise<void> {
  if (!body) return;
  try {
    await body.cancel(reason);
  } catch {
    // The limit response must not depend on transport cancellation succeeding.
  }
}

export type MultipartRequestRouteDependencies = {
  database: AppDatabase;
  storagePaths: StoragePaths;
  appOrigin: string;
  resolveActor: (
    request: Request,
  ) => Promise<AuthenticatedUser | null> | AuthenticatedUser | null;
};

export function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function failureStatus(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "PASSWORD_CHANGE_REQUIRED":
    case "INVALID_ORIGIN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "STATE_CONFLICT":
      return 409;
    case "SYSTEM_UNAVAILABLE":
      return 503;
    default:
      return 400;
  }
}

export function actionResponse<T>(
  result: ActionResult<T>,
  successStatus = 200,
): Response {
  return jsonResponse(result, result.ok ? successStatus : failureStatus(result.code));
}

export function routeFailure(
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
  status = failureStatus(code),
): Response {
  const body = fieldErrors
    ? { ok: false as const, code, message, fieldErrors }
    : { ok: false as const, code, message };
  return jsonResponse(body, status);
}

function declaredBodyExceedsLimit(request: Request): boolean {
  const value = request.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/.test(value)) return false;
  return BigInt(value) > BigInt(MAX_MULTIPART_REQUEST_BYTES);
}

async function readBoundedBody(
  request: Request,
): Promise<Uint8Array<ArrayBuffer>> {
  if (declaredBodyExceedsLimit(request)) {
    await cancelBody(
      request.body,
      "multipart body exceeded its declared size limit",
    );
    throw new MultipartLimitError("单次提交不能超过 32 MiB");
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_MULTIPART_REQUEST_BYTES) {
        try {
          await reader.cancel("multipart body exceeded its size limit");
        } catch {
          // Continue with the stable size-limit response.
        }
        throw new MultipartLimitError("单次提交不能超过 32 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function multipartBoundary(contentType: string | null): string | null {
  if (!contentType || !/^\s*multipart\/form-data(?:\s*;|\s*$)/i.test(contentType)) {
    return null;
  }
  const match = contentType.match(
    /(?:^|;)\s*boundary\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i,
  );
  const boundary = match?.[1]
    ? match[1].replace(/\\(.)/g, "$1")
    : match?.[2];
  if (
    !boundary ||
    boundary.endsWith(" ") ||
    [...boundary].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code > 0x7e;
    })
  ) {
    return null;
  }
  return boundary;
}

function isCrlf(bytes: Buffer, offset: number): boolean {
  return bytes[offset] === 0x0d && bytes[offset + 1] === 0x0a;
}

function skipTransportPadding(bytes: Buffer, offset: number): number {
  let cursor = offset;
  while (bytes[cursor] === 0x20 || bytes[cursor] === 0x09) cursor += 1;
  return cursor;
}

function assertMultipartPartLimit(
  body: Uint8Array,
  contentType: string | null,
): void {
  const boundary = multipartBoundary(contentType);
  if (!boundary) return;

  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const delimiter = Buffer.from(`--${boundary}`, "ascii");
  let searchOffset = 0;
  let partCount = 0;
  while (searchOffset < bytes.length) {
    const boundaryOffset = bytes.indexOf(delimiter, searchOffset);
    if (boundaryOffset === -1) return;
    searchOffset = boundaryOffset + delimiter.length;

    const startsLine =
      boundaryOffset === 0 || isCrlf(bytes, boundaryOffset - 2);
    if (!startsLine) continue;

    let suffixOffset = searchOffset;
    const isClosing =
      bytes[suffixOffset] === 0x2d && bytes[suffixOffset + 1] === 0x2d;
    if (isClosing) suffixOffset += 2;
    suffixOffset = skipTransportPadding(bytes, suffixOffset);
    const hasValidLineEnd =
      suffixOffset === bytes.length || isCrlf(bytes, suffixOffset);
    if (!hasValidLineEnd) continue;
    if (isClosing) return;

    partCount += 1;
    if (partCount > MAX_MULTIPART_PARTS) {
      throw new MultipartLimitError(
        `单次提交最多包含 ${MAX_MULTIPART_PARTS} 个字段和文件`,
      );
    }
  }
}

export async function boundedMultipartFormData(
  request: Request,
): Promise<FormData> {
  const body = await readBoundedBody(request);
  const contentType = request.headers.get("content-type");
  assertMultipartPartLimit(body, contentType);
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: contentType ? { "content-type": contentType } : undefined,
    body: body.buffer,
  });
  const form = await boundedRequest.formData();

  let partCount = 0;
  const parts = form.entries();
  while (!parts.next().done) {
    partCount += 1;
    if (partCount > MAX_MULTIPART_PARTS) {
      throw new MultipartLimitError(
        `单次提交最多包含 ${MAX_MULTIPART_PARTS} 个字段和文件`,
      );
    }
  }
  return form;
}

export function multipartFormFailure(error: unknown): Response {
  if (error instanceof MultipartLimitError) {
    return routeFailure(
      "ATTACHMENT_INVALID",
      error.message,
      { attachments: [error.message] },
      413,
    );
  }
  return routeFailure("INVALID_INPUT", "提交的信息无效");
}

export function unauthenticatedFailure(): ActionFailure {
  return {
    ok: false,
    code: "UNAUTHENTICATED",
    message: "登录已过期，请重新登录",
  };
}

export function formString(
  form: FormData,
  key: string,
): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

export function attachmentFiles(form: FormData): File[] | null {
  const values = [
    ...form.getAll("attachments"),
    ...form.getAll("attachments[]"),
  ];
  return values.every((value) => typeof value !== "string")
    ? values
    : null;
}
