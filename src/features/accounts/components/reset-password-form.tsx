"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, fieldDescriptionIds } from "@/components/ui/field";
import type { ManageableUserDto } from "@/features/accounts/queries";
import { resetUserPasswordRuntimeAction } from "@/features/accounts/runtime-actions";

export function ResetPasswordForm({
  user,
  onCancel,
  onSaved,
}: {
  user: ManageableUserDto;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const prefix = `reset-password-${user.id}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password") ?? "");
    const confirmation = String(values.get("passwordConfirmation") ?? "");
    setPending(true);
    setError(null);
    setFieldErrors({});
    if (password !== confirmation) {
      setFieldErrors({ passwordConfirmation: ["两次输入的密码不一致"] });
      setPending(false);
      return;
    }
    try {
      values.set("userId", String(user.id));
      const result = await resetUserPasswordRuntimeAction(values);
      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onSaved();
    } catch {
      setError("系统暂时不可用，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="management-form" onSubmit={submit} noValidate>
      {error ? (
        <div className="form-alert form-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="management-warning">
        重置后将立即撤销 <strong>{user.displayName}</strong> 的全部登录会话，并要求其首次登录后修改密码。
      </div>
      <Field
        label="新临时密码"
        htmlFor={`${prefix}-password`}
        required
        error={fieldErrors.password?.[0]}
      >
        <input
          id={`${prefix}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          disabled={pending}
          aria-describedby={fieldDescriptionIds(`${prefix}-password`, {
            error: Boolean(fieldErrors.password?.[0]),
          })}
        />
      </Field>
      <Field
        label="确认新临时密码"
        htmlFor={`${prefix}-password-confirmation`}
        required
        error={fieldErrors.passwordConfirmation?.[0]}
      >
        <input
          id={`${prefix}-password-confirmation`}
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          disabled={pending}
          aria-describedby={fieldDescriptionIds(`${prefix}-password-confirmation`, {
            error: Boolean(fieldErrors.passwordConfirmation?.[0]),
          })}
        />
      </Field>
      <div className="management-form__actions">
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "正在重置" : "重置密码"}
        </Button>
      </div>
    </form>
  );
}
