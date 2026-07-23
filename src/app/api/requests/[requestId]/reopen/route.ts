import {
  actionResponse,
  attachmentFiles,
  boundedMultipartFormData,
  formString,
  multipartFormFailure,
  routeFailure,
  unauthenticatedFailure,
  type MultipartRequestRouteDependencies,
} from "@/app/api/requests/route-support";
import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { storagePathsFromEnvironment } from "@/features/attachments/storage";
import { reopenRequestWithAttachments } from "@/features/requests/reopen-service";
import { assertSameOrigin, SameOriginError } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";
import { parseRequestNumber } from "@/lib/request-number";

export const runtime = "nodejs";

type ReopenRouteContext = {
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

function requestIdFrom(value: string): number | null {
  const id = parseRequestNumber(value) ?? Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function createReopenPostHandler(
  dependencies: MultipartRequestRouteDependencies,
): (request: Request, context: ReopenRouteContext) => Promise<Response> {
  return async (request, context) => {
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

    const requestId = requestIdFrom((await context.params).requestId);
    if (requestId === null) {
      return routeFailure("NOT_FOUND", "需求不存在", undefined, 404);
    }

    let form: FormData;
    try {
      form = await boundedMultipartFormData(request);
    } catch (error) {
      return multipartFormFailure(error);
    }
    const files = attachmentFiles(form);
    if (!files) {
      return routeFailure("INVALID_INPUT", "截图字段无效", {
        attachments: ["截图字段无效"],
      });
    }

    return actionResponse(
      await reopenRequestWithAttachments(
        dependencies.database,
        actor,
        {
          requestId,
          expectedVersion: Number(formString(form, "expectedVersion")),
          reason: formString(form, "reason") ?? "",
          idempotencyKey: formString(form, "idempotencyKey") ?? "",
        },
        files,
        dependencies.storagePaths,
      ),
    );
  };
}

export async function POST(
  request: Request,
  context: ReopenRouteContext,
): Promise<Response> {
  return createReopenPostHandler(runtimeDependencies())(request, context);
}
