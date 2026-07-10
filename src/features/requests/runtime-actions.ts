"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import {
  archiveRequest,
  changeProgress,
  pauseRequest,
  restoreRequest,
  resumeRequest,
} from "@/features/requests/service";
import type {
  ChangeProgressInput,
  RequestLifecycleInput,
} from "@/features/requests/schemas";
import { actionFailure } from "@/lib/action-result";

async function actorAndDatabase() {
  const database = getRuntimeDatabase();
  const actor = await getCurrentUser(database);
  return { database, actor };
}

function refreshRequest(requestId: number): void {
  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
}

export async function changeProgressRuntimeAction(input: ChangeProgressInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await changeProgress(database, actor, input);
  if (result.ok) refreshRequest(result.data.id);
  return result;
}

export async function pauseRequestRuntimeAction(input: RequestLifecycleInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await pauseRequest(database, actor, input);
  if (result.ok) refreshRequest(result.data.id);
  return result;
}

export async function resumeRequestRuntimeAction(input: RequestLifecycleInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await resumeRequest(database, actor, input);
  if (result.ok) refreshRequest(result.data.id);
  return result;
}

export async function archiveRequestRuntimeAction(input: RequestLifecycleInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await archiveRequest(database, actor, input);
  if (result.ok) refreshRequest(result.data.id);
  return result;
}

export async function restoreRequestRuntimeAction(input: RequestLifecycleInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await restoreRequest(database, actor, input);
  if (result.ok) refreshRequest(result.data.id);
  return result;
}
