"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import type {
  CreateProjectInput,
  SetProjectActiveInput,
  UpdateProjectInput,
} from "@/features/projects/schemas";
import {
  createProject,
  setProjectActive,
  updateProject,
} from "@/features/projects/service";
import { actionFailure } from "@/lib/action-result";

async function actorAndDatabase() {
  const database = getRuntimeDatabase();
  const actor = await getCurrentUser(database);
  return { actor, database };
}

function refreshProjects(): void {
  revalidatePath("/manage/projects");
  revalidatePath("/manage/users");
  revalidatePath("/requests");
  revalidatePath("/requests/new");
}

export async function createProjectRuntimeAction(input: CreateProjectInput) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await createProject(database, actor, input);
  if (result.ok) refreshProjects();
  return result;
}

export async function updateProjectRuntimeAction(input: UpdateProjectInput) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await updateProject(database, actor, input);
  if (result.ok) refreshProjects();
  return result;
}

export async function setProjectActiveRuntimeAction(
  input: SetProjectActiveInput,
) {
  const { actor, database } = await actorAndDatabase();
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const result = await setProjectActive(database, actor, input);
  if (result.ok) refreshProjects();
  return result;
}
