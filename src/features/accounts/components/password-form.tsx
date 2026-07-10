"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";

import { changePasswordRuntimeAction } from "@/auth/runtime-actions";
import { Button } from "@/components/ui/button";
import { Field, fieldDescriptionIds } from "@/components/ui/field";
import type { ActionResult } from "@/lib/action-result";

type PasswordSubmitResult = ActionResult<{ redirectTo: "/login" }>;

export function PasswordForm({
  username,
  submitAction = changePasswordRuntimeAction,
}: {
  username: string;
  submitAction?: (formData: FormData) => Promise<PasswordSubmitResult>;
}) {
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const formData = new FormData(event.currentTarget);
    if (formData.get("newPassword") !== formData.get("confirmPassword")) {
      setConfirmationError("两次输入的新密码不一致");
      return;
    }
    setConfirmationError(null);
    setError(null);
    setIsPending(true);
    try {
      formData.delete("confirmPassword");
      const result = await submitAction(formData);
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
    <form aria-label="修改密码" className="auth-form" onSubmit={handleSubmit}>
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={username}
        readOnly
        hidden
      />
      {error ? (
        <div className="form-alert form-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <Field label="当前密码" htmlFor="oldPassword" required>
        <input
          id="oldPassword"
          aria-label="当前密码"
          name="oldPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field
        label="新密码"
        htmlFor="newPassword"
        hint="建议使用 10 个以上字符，并避免与其他系统共用密码。"
        required
      >
        <input
          id="newPassword"
          aria-label="新密码"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={10}
          aria-describedby={fieldDescriptionIds("newPassword", { hint: true })}
          required
        />
      </Field>
      <Field
        label="确认新密码"
        htmlFor="confirmPassword"
        error={confirmationError ?? undefined}
        required
      >
        <input
          id="confirmPassword"
          aria-label="确认新密码"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={10}
          aria-invalid={confirmationError ? true : undefined}
          aria-describedby={fieldDescriptionIds("confirmPassword", {
            error: Boolean(confirmationError),
          })}
          required
        />
      </Field>
      <Button type="submit" disabled={isPending} className="button--full">
        <KeyRound aria-hidden="true" size={17} />
        {isPending ? "正在修改" : "修改密码"}
      </Button>
    </form>
  );
}
