"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, fieldDescriptionIds } from "@/components/ui/field";
import type { ManageableUserDto } from "@/features/accounts/queries";
import {
  createUserRuntimeAction,
  updateUserIdentityRuntimeAction,
} from "@/features/accounts/runtime-actions";

export function UserForm({
  user,
  onCancel,
  onSaved,
}: {
  user?: ManageableUserDto;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const prefix = user ? `user-${user.id}` : "user-new";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password") ?? "");
    const passwordConfirmation = String(values.get("passwordConfirmation") ?? "");
    setPending(true);
    setError(null);
    setFieldErrors({});
    if (!user && password !== passwordConfirmation) {
      setFieldErrors({ passwordConfirmation: ["两次输入的密码不一致"] });
      setPending(false);
      return;
    }

    try {
      const identity = {
        username: String(values.get("username") ?? ""),
        displayName: String(values.get("displayName") ?? ""),
      };
      const result = user
        ? await updateUserIdentityRuntimeAction({ userId: user.id, ...identity })
        : await createUserRuntimeAction(values);
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
      <div className="management-form__grid">
        <Field
          label="用户名"
          htmlFor={`${prefix}-username`}
          required
          error={fieldErrors.username?.[0]}
          hint="3-32 位小写字母、数字、点、下划线或连字符。"
        >
          <input
            id={`${prefix}-username`}
            name="username"
            defaultValue={user?.username ?? ""}
            autoComplete="off"
            disabled={pending}
            aria-describedby={fieldDescriptionIds(`${prefix}-username`, {
              hint: true,
              error: Boolean(fieldErrors.username?.[0]),
            })}
          />
        </Field>
        <Field
          label="显示名"
          htmlFor={`${prefix}-display-name`}
          required
          error={fieldErrors.displayName?.[0]}
        >
          <input
            id={`${prefix}-display-name`}
            name="displayName"
            defaultValue={user?.displayName ?? ""}
            autoComplete="name"
            disabled={pending}
            aria-describedby={fieldDescriptionIds(`${prefix}-display-name`, {
              error: Boolean(fieldErrors.displayName?.[0]),
            })}
          />
        </Field>
      </div>

      {user ? (
        <div className="management-readonly-field">
          <span>账号类型</span>
          <strong>{user.role === "DEVELOPER" ? "开发者" : "客户"}</strong>
          <small>账号创建后类型不可修改。</small>
        </div>
      ) : (
        <>
          <Field label="账号类型" htmlFor={`${prefix}-role`} required>
            <select id={`${prefix}-role`} name="role" defaultValue="CUSTOMER" disabled={pending}>
              <option value="CUSTOMER">客户</option>
              <option value="DEVELOPER">开发者</option>
            </select>
          </Field>
          <div className="management-form__grid">
            <Field
              label="临时密码"
              htmlFor={`${prefix}-password`}
              required
              error={fieldErrors.password?.[0]}
              hint="首次登录后必须修改，系统不会再次显示此密码。"
            >
              <input
                id={`${prefix}-password`}
                name="password"
                type="password"
                autoComplete="new-password"
                disabled={pending}
                aria-describedby={fieldDescriptionIds(`${prefix}-password`, {
                  hint: true,
                  error: Boolean(fieldErrors.password?.[0]),
                })}
              />
            </Field>
            <Field
              label="确认临时密码"
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
                aria-describedby={fieldDescriptionIds(
                  `${prefix}-password-confirmation`,
                  { error: Boolean(fieldErrors.passwordConfirmation?.[0]) },
                )}
              />
            </Field>
          </div>
        </>
      )}

      <div className="management-form__actions">
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "正在保存" : user ? "保存账号" : "创建账号"}
        </Button>
      </div>
    </form>
  );
}
