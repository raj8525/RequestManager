"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import type {
  ReplaceCustomerMembershipsInput,
  SetUserActiveInput,
  UpdateUserIdentityInput,
} from "@/features/accounts/schemas";
import { userRoleSchema } from "@/features/accounts/schemas";
import {
  createUser,
  replaceCustomerMemberships,
  resetUserPassword,
  setUserActive,
  updateUserIdentity,
} from "@/features/accounts/service";
import { actionFailure } from "@/lib/action-result";

async function actorAndDatabase() {
  const database = getRuntimeDatabase();
  const actor = await getCurrentUser(database);
  return { actor, database };
}

function refreshAccounts(): void {
  revalidatePath("/manage/users");
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createUserRuntimeAction(formData: FormData) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const role = userRoleSchema.safeParse(formString(formData, "role"));
  if (!role.success) {
    return actionFailure("INVALID_INPUT", "账号类型无效", {
      role: ["请选择有效的账号类型"],
    });
  }
  const result = await createUser(database, actor, {
    username: formString(formData, "username"),
    displayName: formString(formData, "displayName"),
    password: formString(formData, "password"),
    role: role.data,
  });
  if (result.ok) refreshAccounts();
  return result;
}

export async function updateUserIdentityRuntimeAction(
  input: UpdateUserIdentityInput,
) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await updateUserIdentity(database, actor, input);
  if (result.ok) refreshAccounts();
  return result;
}

export async function resetUserPasswordRuntimeAction(
  formData: FormData,
) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await resetUserPassword(database, actor, {
    userId: Number(formString(formData, "userId")),
    password: formString(formData, "password"),
  });
  if (result.ok) refreshAccounts();
  return result;
}

export async function setUserActiveRuntimeAction(input: SetUserActiveInput) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await setUserActive(database, actor, input);
  if (result.ok) refreshAccounts();
  return result;
}

export async function replaceCustomerMembershipsRuntimeAction(
  input: ReplaceCustomerMembershipsInput,
) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await replaceCustomerMemberships(database, actor, input);
  if (result.ok) {
    refreshAccounts();
    revalidatePath("/requests");
  }
  return result;
}
