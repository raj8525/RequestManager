import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";

import { getCurrentUser } from "@/auth/current-user";
import type { AuthenticatedUser } from "@/auth/session-service";
import { getRuntimeDatabase } from "@/db/runtime";
import type { AppDatabase } from "@/db/types";
import { getAuthorizedAttachment } from "@/features/attachments/authorization";
import {
  resolveCommittedAttachmentPath,
  storagePathsFromEnvironment,
  type StoragePaths,
} from "@/features/attachments/storage";

export const runtime = "nodejs";

type AttachmentRouteContext = {
  params: Promise<{ attachmentId: string }>;
};

export type AttachmentGetDependencies = {
  database: AppDatabase;
  storagePaths: StoragePaths;
  resolveActor: (
    request: Request,
  ) => Promise<AuthenticatedUser | null> | AuthenticatedUser | null;
};

function runtimeDependencies(): AttachmentGetDependencies {
  const database = getRuntimeDatabase();
  return {
    database,
    storagePaths: storagePathsFromEnvironment(),
    resolveActor: () => getCurrentUser(database),
  };
}

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createGetHandler(
  dependencies: AttachmentGetDependencies,
): (request: Request, context: AttachmentRouteContext) => Promise<Response> {
  return async (
    request: Request,
    context: AttachmentRouteContext,
  ): Promise<Response> => {
    const params = await context.params;
    const attachmentId = Number(params.attachmentId);
    if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
      return notFound();
    }

    let actor;
    try {
      actor = await dependencies.resolveActor(request);
    } catch {
      return notFound();
    }
    const attachment = getAuthorizedAttachment(
      dependencies.database,
      actor,
      attachmentId,
    );
    if (!attachment) return notFound();

    let handle;
    try {
      const path = resolveCommittedAttachmentPath(
        attachment.storageName,
        dependencies.storagePaths,
      );
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size !== attachment.sizeBytes) {
        await handle.close();
        return notFound();
      }
      const stream = Readable.toWeb(handle.createReadStream());
      return new Response(stream as ReadableStream<Uint8Array>, {
        status: 200,
        headers: {
          "Content-Type": attachment.mimeType,
          "Content-Length": String(attachment.sizeBytes),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      return notFound();
    }
  };
}

export async function GET(
  request: Request,
  context: AttachmentRouteContext,
): Promise<Response> {
  return createGetHandler(runtimeDependencies())(request, context);
}
