export type ActionFailureCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_CURRENT_PASSWORD"
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "SYSTEM_UNAVAILABLE";

export type ActionFailure = {
  ok: false;
  code: ActionFailureCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionSuccess<T> = {
  ok: true;
  data: T;
};

export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

export function actionSuccess<T>(data: T): ActionSuccess<T> {
  return { ok: true, data };
}

export function actionFailure(
  code: ActionFailureCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionFailure {
  return fieldErrors
    ? { ok: false, code, message, fieldErrors }
    : { ok: false, code, message };
}
