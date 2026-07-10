"use client";

import { LogIn } from "lucide-react";
import { useState } from "react";

import {
  loginRuntimeAction,
  type LoginRuntimeResult,
} from "@/auth/runtime-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function LoginForm({
  submitAction = loginRuntimeAction,
}: {
  submitAction?: (formData: FormData) => Promise<LoginRuntimeResult>;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await submitAction(new FormData(event.currentTarget));
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.assign(result.data.redirectTo);
    } catch {
      setError("系统暂时不可用，请稍后重试");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form aria-label="登录" className="auth-form" onSubmit={handleSubmit}>
      {error ? (
        <div className="form-alert form-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <Field label="用户名" htmlFor="username" required>
        <input
          id="username"
          aria-label="用户名"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
        />
      </Field>
      <Field label="密码" htmlFor="password" required>
        <input
          id="password"
          aria-label="密码"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Button type="submit" disabled={isPending} className="button--full">
        <LogIn aria-hidden="true" size={17} />
        {isPending ? "正在登录" : "登录"}
      </Button>
    </form>
  );
}
