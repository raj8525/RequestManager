"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { markDeveloperQuestionSeen } from "./service";

export async function markDeveloperQuestionSeenRuntimeAction(questionId: number, expectedVersion: number) {
  const database = getRuntimeDatabase(); const actor = await getCurrentUser(database); if (!actor) return { ok: false as const, code: "UNAUTHENTICATED", message: "登录已过期，请重新登录" };
  const result = await markDeveloperQuestionSeen(database, actor, { questionId, expectedVersion });
  if (result.ok) { revalidatePath("/requests"); revalidatePath(`/questions/${result.data.questionNumber}`); }
  return result;
}
