import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { createRequestWithAttachments } from "@/features/attachments/service";
import {
  storagePathsFromEnvironment,
} from "@/features/attachments/storage";
import { assertSameOrigin, SameOriginError } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";
import type { CreateRequestInput } from "@/features/requests/schemas";

import {
  actionResponse,
  attachmentFiles,
  formString,
  routeFailure,
  unauthenticatedFailure,
  type MultipartRequestRouteDependencies,
} from "./route-support";

export const runtime = "nodejs";

function runtimeDependencies(): MultipartRequestRouteDependencies {
  const database = getRuntimeDatabase();
  return {
    database,
    storagePaths: storagePathsFromEnvironment(),
    appOrigin: getEnvironment().appOrigin,
    resolveActor: () => getCurrentUser(database),
  };
}

export function createPostHandler(
  dependencies: MultipartRequestRouteDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
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

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return routeFailure("INVALID_INPUT", "提交的信息无效");
    }
    const files = attachmentFiles(form);
    if (!files) {
      return routeFailure("INVALID_INPUT", "提交的信息无效", {
        attachments: ["截图字段无效"],
      });
    }

    const priority = formString(form, "priority");
    const result = await createRequestWithAttachments(
      dependencies.database,
      actor,
      {
        projectId: Number(formString(form, "projectId")),
        content: formString(form, "content") ?? "",
        requestType: formString(form, "requestType") ?? "",
        ...(priority === undefined ? {} : { priority }),
        idempotencyKey: formString(form, "idempotencyKey") ?? "",
      } as CreateRequestInput,
      files,
      dependencies.storagePaths,
    );
    return actionResponse(result, 201);
  };
}

export async function POST(request: Request): Promise<Response> {
  return createPostHandler(runtimeDependencies())(request);
}
