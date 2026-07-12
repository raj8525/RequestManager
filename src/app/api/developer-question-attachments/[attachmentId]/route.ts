import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { resolveCommittedAttachmentPath, storagePathsFromEnvironment } from "@/features/attachments/storage";
import { getDeveloperQuestionAttachment } from "@/features/developer-questions/queries";
export const runtime = "nodejs";
function missing() { return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) { const id = Number((await context.params).attachmentId); if (!Number.isSafeInteger(id) || id <= 0) return missing(); const db = getRuntimeDatabase(); const actor = await getCurrentUser(db); if (!actor) return missing(); const result = getDeveloperQuestionAttachment(db, actor, id); if (!result.ok) return missing(); let handle; try { handle = await open(resolveCommittedAttachmentPath(result.data.storageName, storagePathsFromEnvironment()), constants.O_RDONLY | constants.O_NOFOLLOW); const stats = await handle.stat(); if (!stats.isFile() || stats.size !== result.data.sizeBytes) { await handle.close(); return missing(); } return new Response(Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>, { headers: { "Content-Type": result.data.mimeType, "Content-Length": String(result.data.sizeBytes), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); } catch { if (handle) await handle.close().catch(() => undefined); return missing(); } }
