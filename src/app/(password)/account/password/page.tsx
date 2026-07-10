import type { Metadata } from "next";

import { requireCurrentUser } from "@/auth/current-user";
import { getRuntimeDatabase } from "@/db/runtime";
import { PasswordForm } from "@/features/accounts/components/password-form";

export const metadata: Metadata = { title: "修改密码" };

export default async function PasswordPage() {
  const actor = await requireCurrentUser(getRuntimeDatabase());
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="password-title">
        <div className="auth-brand" aria-hidden="true">RM</div>
        <p className="auth-panel__product">{actor.displayName}</p>
        <h1 id="password-title">
          {actor.mustChangePassword ? "首次登录，请修改密码" : "修改您的密码"}
        </h1>
        <p className="auth-panel__description">
          用户名 @{actor.username} 不可自行修改。改密后所有登录会话会退出。
        </p>
        <PasswordForm />
      </section>
    </main>
  );
}
