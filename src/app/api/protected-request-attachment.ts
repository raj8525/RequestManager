import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";

import type { AuthenticatedUser } from "@/auth/session-service";
import type { AppDatabase } from "@/db/types";
import {
  resolveCommittedAttachmentPath,
  type StoragePaths,
} from "@/features/attachments/storage";
import { getRequestDetail } from "@/features/requests/queries";

type ProtectedAttachment = {
  requestId: number;
  storageName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ProtectedAttachmentDependencies = {
  database: AppDatabase;
  storagePaths: StoragePaths;
  resolveActor: (request: Request) => Promise<AuthenticatedUser | null>;
  findAttachment: (
    database: AppDatabase,
    attachmentId: number,
  ) => ProtectedAttachment | undefined;
};

function missing(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createProtectedAttachmentGetHandler(
  dependencies: ProtectedAttachmentDependencies,
): (
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) => Promise<Response> {
  return async (request, context) => {
    const attachmentId = Number((await context.params).attachmentId);
    if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return missing();

    let actor: AuthenticatedUser | null;
    try {
      actor = await dependencies.resolveActor(request);
    } catch {
      return missing();
    }
    if (!actor) return missing();

    const attachment = dependencies.findAttachment(
      dependencies.database,
      attachmentId,
    );
    if (!attachment) return missing();
    const authorized = getRequestDetail(
      dependencies.database,
      actor,
      attachment.requestId,
    );
    if (!authorized.ok) return missing();

    let handle;
    try {
      handle = await open(
        resolveCommittedAttachmentPath(
          attachment.storageName,
          dependencies.storagePaths,
        ),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size !== attachment.sizeBytes) {
        await handle.close();
        return missing();
      }
      return new Response(
        Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>,
        {
          headers: {
            "Content-Type": attachment.mimeType,
            "Content-Length": String(attachment.sizeBytes),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      return missing();
    }
  };
}
