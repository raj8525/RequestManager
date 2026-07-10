import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import {
  editRequestWithAttachments,
  type EditRequestWithAttachmentsInput,
} from "@/features/attachments/service";
import { storagePathsFromEnvironment } from "@/features/attachments/storage";
import { assertSameOrigin, SameOriginError } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";
import { parseRequestNumber } from "@/lib/request-number";

import {
  actionResponse,
  attachmentFiles,
  boundedMultipartFormData,
  formString,
  multipartFormFailure,
  routeFailure,
  unauthenticatedFailure,
  type MultipartRequestRouteDependencies,
} from "../route-support";

export const runtime = "nodejs";

type RequestRouteContext = {
  params: Promise<{ requestId: string }>;
};

function runtimeDependencies(): MultipartRequestRouteDependencies {
  const database = getRuntimeDatabase();
  return {
    database,
    storagePaths: storagePathsFromEnvironment(),
    appOrigin: getEnvironment().appOrigin,
    resolveActor: () => getCurrentUser(database),
  };
}

function parseRouteRequestId(value: string): number | null {
  const requestNumber = parseRequestNumber(value);
  if (requestNumber !== null) return requestNumber;
  const numericId = Number(value);
  return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
}

function retainedAttachmentIds(form: FormData): number[] | null {
  const values = [
    ...form.getAll("retainedAttachmentIds"),
    ...form.getAll("retainedAttachmentIds[]"),
  ];
  if (values.some((value) => typeof value !== "string")) return null;
  if (values.length === 1 && (values[0] as string).trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(values[0] as string);
      if (!Array.isArray(parsed)) return null;
      const ids = parsed.map(Number);
      return ids.every(Number.isSafeInteger) ? ids : null;
    } catch {
      return null;
    }
  }
  const ids = (values as string[]).map(Number);
  return ids.every(Number.isSafeInteger) ? ids : null;
}

export function createPutHandler(
  dependencies: MultipartRequestRouteDependencies,
): (request: Request, context: RequestRouteContext) => Promise<Response> {
  return async (
    request: Request,
    context: RequestRouteContext,
  ): Promise<Response> => {
    try {
      assertSameOrigin(request, dependencies.appOrigin);
    } catch (error) {
      if (error instanceof SameOriginError) {
        return routeFailure("INVALID_ORIGIN", "请求来源无效");
      }
      throw error;
    }

    let actor;
    try {
      actor = await dependencies.resolveActor(request);
    } catch {
      return routeFailure(
        "SYSTEM_UNAVAILABLE",
        "系统暂时不可用，请稍后重试",
      );
    }
    if (!actor) return actionResponse(unauthenticatedFailure());
    const params = await context.params;
    const requestId = parseRouteRequestId(params.requestId);
    if (requestId === null) return routeFailure("NOT_FOUND", "需求不存在");

    let form: FormData;
    try {
      form = await boundedMultipartFormData(request);
    } catch (error) {
      return multipartFormFailure(error);
    }
    const files = attachmentFiles(form);
    const retainedIds = retainedAttachmentIds(form);
    if (!files || !retainedIds) {
      return routeFailure("INVALID_INPUT", "提交的信息无效", {
        attachments: ["截图字段无效"],
      });
    }

    const result = await editRequestWithAttachments(
      dependencies.database,
      actor,
      {
        requestId,
        expectedVersion: Number(formString(form, "expectedVersion")),
        content: formString(form, "content") ?? "",
        requestType: formString(form, "requestType") ?? "",
        priority: formString(form, "priority") ?? "",
        retainedAttachmentIds: retainedIds,
      } as EditRequestWithAttachmentsInput,
      files,
      dependencies.storagePaths,
    );
    return actionResponse(result);
  };
}

export async function PUT(
  request: Request,
  context: RequestRouteContext,
): Promise<Response> {
  return createPutHandler(runtimeDependencies())(request, context);
}
