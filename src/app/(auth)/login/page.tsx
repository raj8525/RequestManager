import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { LoginForm } from "@/features/accounts/components/login-form";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage() {
  const actor = await getCurrentUser(getRuntimeDatabase());
  if (actor) redirect(actor.mustChangePassword ? "/account/password" : "/requests");

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-brand" aria-hidden="true">RM</div>
        <p className="auth-panel__product">RequestManager</p>
        <h1 id="login-title">登录需求工作区</h1>
        <p className="auth-panel__description">使用开发者分配给您的用户名和密码登录。</p>
        <LoginForm />
      </section>
    </main>
  );
}
