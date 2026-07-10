import { redirect } from "next/navigation";

import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";

export default async function Home() {
  const actor = await getCurrentUser(getRuntimeDatabase());
  if (!actor) redirect("/login");
  redirect(actor.mustChangePassword ? "/account/password" : "/requests");
}
