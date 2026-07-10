import type { AuthenticatedUser } from "@/auth/session-service";
import type { AppDatabase } from "@/db/types";
import type { StoragePaths } from "@/features/attachments/storage";
import type { ActionFailure, ActionResult } from "@/lib/action-result";

export type MultipartRequestRouteDependencies = {
  database: AppDatabase;
  storagePaths: StoragePaths;
  appOrigin: string;
  resolveActor: (
    request: Request,
  ) => Promise<AuthenticatedUser | null> | AuthenticatedUser | null;
};

export function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function failureStatus(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "PASSWORD_CHANGE_REQUIRED":
    case "INVALID_ORIGIN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "STATE_CONFLICT":
      return 409;
    case "SYSTEM_UNAVAILABLE":
      return 503;
    default:
      return 400;
  }
}

export function actionResponse<T>(
  result: ActionResult<T>,
  successStatus = 200,
): Response {
  return jsonResponse(result, result.ok ? successStatus : failureStatus(result.code));
}

export function routeFailure(
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
): Response {
  const body = fieldErrors
    ? { ok: false as const, code, message, fieldErrors }
    : { ok: false as const, code, message };
  return jsonResponse(body, failureStatus(code));
}

export function unauthenticatedFailure(): ActionFailure {
  return {
    ok: false,
    code: "UNAUTHENTICATED",
    message: "登录已过期，请重新登录",
  };
}

export function formString(
  form: FormData,
  key: string,
): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

export function attachmentFiles(form: FormData): File[] | null {
  const values = [
    ...form.getAll("attachments"),
    ...form.getAll("attachments[]"),
  ];
  return values.every((value) => typeof value !== "string")
    ? values
    : null;
}
