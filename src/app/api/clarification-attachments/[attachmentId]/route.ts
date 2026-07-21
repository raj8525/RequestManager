import { eq } from "drizzle-orm";

import { createProtectedAttachmentGetHandler } from "@/app/api/protected-request-attachment";
import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { clarificationMessageAttachments } from "@/db/schema";
import { storagePathsFromEnvironment } from "@/features/attachments/storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const database = getRuntimeDatabase();
  return createProtectedAttachmentGetHandler({
    database,
    storagePaths: storagePathsFromEnvironment(),
    resolveActor: () => getCurrentUser(database),
    findAttachment: (db, id) =>
      db.db
        .select()
        .from(clarificationMessageAttachments)
        .where(eq(clarificationMessageAttachments.id, id))
        .get(),
  })(request, context);
}
