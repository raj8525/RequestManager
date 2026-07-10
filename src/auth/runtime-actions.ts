"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  changeOwnPasswordAction,
  loginAction,
  logoutAction,
} from "@/auth/actions";
import { getRuntimeDatabase } from "@/db/runtime";
import {
  actionFailure,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";

export type LoginRuntimeResult = ActionResult<{
  redirectTo: "/requests" | "/account/password";
}>;

export async function loginRuntimeAction(
  formData: FormData,
): Promise<LoginRuntimeResult> {
  const result = await loginAction(getRuntimeDatabase(), formData);
  if (!result.ok) return result;
  return actionSuccess({
    redirectTo: result.data.mustChangePassword
      ? "/account/password"
      : "/requests",
  });
}

export async function logoutRuntimeAction(): Promise<void> {
  const result = await logoutAction(getRuntimeDatabase());
  if (!result.ok) return;
  redirect("/login");
}

export async function changePasswordRuntimeAction(
  formData: FormData,
): Promise<ActionResult<{ redirectTo: "/login" }>> {
  const result = await changeOwnPasswordAction(
    getRuntimeDatabase(),
    formData,
    { redirect: () => undefined },
  );
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return actionSuccess({ redirectTo: "/login" });
}

export async function unavailableAuthAction(): Promise<ActionResult<never>> {
  return actionFailure("SYSTEM_UNAVAILABLE", "系统暂时不可用，请稍后重试");
}
