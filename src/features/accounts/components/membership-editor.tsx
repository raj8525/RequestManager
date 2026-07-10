"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { ManageableUserDto } from "@/features/accounts/queries";
import { replaceCustomerMembershipsRuntimeAction } from "@/features/accounts/runtime-actions";

export type MembershipProjectOption = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
};

export function MembershipEditor({
  user,
  projects,
  onCancel,
  onSaved,
}: {
  user: ManageableUserDto;
  projects: readonly MembershipProjectOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const projectIds = values
      .getAll("projectIds")
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    setPending(true);
    setError(null);
    try {
      const result = await replaceCustomerMembershipsRuntimeAction({
        customerId: user.id,
        projectIds,
      });
      if (!result.ok) {
        setError(result.message);
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
    <form className="management-form" onSubmit={submit}>
      {error ? (
        <div className="form-alert form-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="management-form__intro">
        保存后会立即替换 <strong>{user.displayName}</strong> 的全部项目权限。
      </p>
      {projects.length === 0 ? (
        <div className="management-empty management-empty--compact">
          <strong>暂无可分配项目</strong>
          <span>请先创建项目。</span>
        </div>
      ) : (
        <div className="membership-list" role="group" aria-label="客户项目权限">
          {projects.map((project) => (
            <label key={project.id} className="membership-option">
              <input
                type="checkbox"
                name="projectIds"
                value={project.id}
                defaultChecked={user.projectIds.includes(project.id)}
                disabled={pending}
              />
              <span>
                <strong>{project.code} · {project.name}</strong>
                <small>{project.isActive ? "启用" : "已停用，仅可查看已有需求"}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="management-form__actions">
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={pending || !user.isActive}>
          {pending ? "正在保存" : "保存项目权限"}
        </Button>
      </div>
    </form>
  );
}
