import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { storagePathsFromEnvironment } from "@/features/attachments/storage";
import { createDeveloperQuestion } from "@/features/developer-questions/service";
import { assertSameOrigin, SameOriginError } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";
import { actionResponse, attachmentFiles, boundedMultipartFormData, formString, multipartFormFailure, routeFailure, unauthenticatedFailure } from "@/app/api/requests/route-support";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try { assertSameOrigin(request, getEnvironment().appOrigin); } catch (error) { if (error instanceof SameOriginError) return routeFailure("INVALID_ORIGIN", "请求来源无效"); throw error; }
  const database = getRuntimeDatabase(); const actor = await getCurrentUser(database); if (!actor) return actionResponse(unauthenticatedFailure());
  let form: FormData; try { form = await boundedMultipartFormData(request); } catch (error) { return multipartFormFailure(error); }
  const files = attachmentFiles(form); if (!files) return routeFailure("INVALID_INPUT", "截图字段无效");
  const result = await createDeveloperQuestion(database, actor, { projectId: Number(formString(form, "projectId")), content: formString(form, "content") ?? "", idempotencyKey: formString(form, "idempotencyKey") ?? "" }, files, storagePathsFromEnvironment());
  return actionResponse(result, 201);
}
