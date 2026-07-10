"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import {
  addPublicRemark,
  askClarification,
  replyToClarification,
  saveOwnPrivateNote,
} from "@/features/communication/service";
import type {
  AddPublicRemarkInput,
  ClarificationMessageInput,
  SaveOwnPrivateNoteInput,
} from "@/features/communication/schemas";
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

export async function addPublicRemarkRuntimeAction(input: AddPublicRemarkInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await addPublicRemark(database, actor, input);
  if (result.ok) refreshRequest(input.requestId);
  return result;
}

export async function savePrivateNoteRuntimeAction(input: SaveOwnPrivateNoteInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  return saveOwnPrivateNote(database, actor, input);
}

export async function askClarificationRuntimeAction(input: ClarificationMessageInput) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await askClarification(database, actor, input);
  if (result.ok) refreshRequest(input.requestId);
  return result;
}

export async function replyClarificationRuntimeAction(
  input: ClarificationMessageInput,
) {
  const { database, actor } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await replyToClarification(database, actor, input);
  if (result.ok) refreshRequest(input.requestId);
  return result;
}
