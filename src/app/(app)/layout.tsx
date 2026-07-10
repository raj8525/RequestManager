import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requireCurrentUser } from "@/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { getRuntimeDatabase } from "@/db/runtime";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const actor = await requireCurrentUser(getRuntimeDatabase());
  if (actor.mustChangePassword) redirect("/account/password");
  return <AppShell actor={actor}>{children}</AppShell>;
}
