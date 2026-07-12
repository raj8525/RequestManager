import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { storagePathsFromEnvironment } from "@/features/attachments/storage";
import { appendDeveloperQuestionMessage } from "@/features/developer-questions/service";
import { parseQuestionNumber } from "@/lib/question-number";
import { assertSameOrigin, SameOriginError } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";
import { actionResponse, attachmentFiles, boundedMultipartFormData, formString, multipartFormFailure, routeFailure, unauthenticatedFailure } from "@/app/api/requests/route-support";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }): Promise<Response> {
  try { assertSameOrigin(request, getEnvironment().appOrigin); } catch (error) { if (error instanceof SameOriginError) return routeFailure("INVALID_ORIGIN", "请求来源无效"); throw error; }
  const database = getRuntimeDatabase(); const actor = await getCurrentUser(database); if (!actor) return actionResponse(unauthenticatedFailure());
  const raw = (await context.params).questionId; const questionId = parseQuestionNumber(raw) ?? Number(raw); if (!Number.isSafeInteger(questionId) || questionId <= 0) return routeFailure("NOT_FOUND", "开发者提问不存在", undefined, 404);
  let form: FormData; try { form = await boundedMultipartFormData(request); } catch (error) { return multipartFormFailure(error); }
  const files = attachmentFiles(form); if (!files) return routeFailure("INVALID_INPUT", "截图字段无效");
  return actionResponse(await appendDeveloperQuestionMessage(database, actor, { questionId, expectedVersion: Number(formString(form, "expectedVersion")), content: formString(form, "content") ?? "", idempotencyKey: formString(form, "idempotencyKey") ?? "" }, files, storagePathsFromEnvironment()), 201);
}
