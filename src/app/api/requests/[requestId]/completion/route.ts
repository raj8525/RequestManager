import {
  actionResponse,
  attachmentFiles,
  boundedMultipartFormData,
  formString,
  multipartFormFailure,
  routeFailure,
  unauthenticatedFailure,
} from "@/app/api/requests/route-support";
import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { storagePathsFromEnvironment } from "@/features/attachments/storage";
import { saveCompletionNote } from "@/features/completion-notes/service";
import { getCompletionNote } from "@/features/completion-notes/queries";
import { assertSameOrigin, SameOriginError } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";
import { parseRequestNumber } from "@/lib/request-number";

export const runtime = "nodejs";

function requestIdFrom(value: string): number | null {
  const id = parseRequestNumber(value) ?? Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  const requestId = requestIdFrom((await context.params).requestId);
  if (requestId === null) return routeFailure("NOT_FOUND", "需求不存在", undefined, 404);
  const database = getRuntimeDatabase();
  const actor = await getCurrentUser(database);
  if (!actor) return actionResponse(unauthenticatedFailure());
  return actionResponse(getCompletionNote(database, actor, requestId));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  try {
    assertSameOrigin(request, getEnvironment().appOrigin);
  } catch (error) {
    if (error instanceof SameOriginError) {
      return routeFailure("INVALID_ORIGIN", "请求来源无效");
    }
    throw error;
  }
  const requestId = requestIdFrom((await context.params).requestId);
  if (requestId === null) return routeFailure("NOT_FOUND", "需求不存在", undefined, 404);
  const database = getRuntimeDatabase();
  const actor = await getCurrentUser(database);
  if (!actor) return actionResponse(unauthenticatedFailure());

  let form: FormData;
  try {
    form = await boundedMultipartFormData(request);
  } catch (error) {
    return multipartFormFailure(error);
  }
  const files = attachmentFiles(form);
  if (!files) return routeFailure("INVALID_INPUT", "截图字段无效");
  const retainedAttachmentIds = form
    .getAll("retainedAttachmentIds")
    .filter((value): value is string => typeof value === "string")
    .map(Number);
  return actionResponse(
    await saveCompletionNote(
      database,
      actor,
      {
        requestId,
        expectedVersion: Number(formString(form, "expectedVersion")),
        content: formString(form, "content") ?? "",
        retainedAttachmentIds,
        completeRequest: formString(form, "completeRequest") === "true",
      },
      files,
      storagePathsFromEnvironment(),
    ),
  );
}
