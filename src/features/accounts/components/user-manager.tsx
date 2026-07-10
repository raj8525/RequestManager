"use client";

import {
  FolderKey,
  KeyRound,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ManagementDialog } from "@/components/management-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  MembershipEditor,
  type MembershipProjectOption,
} from "@/features/accounts/components/membership-editor";
import { ResetPasswordForm } from "@/features/accounts/components/reset-password-form";
import { UserForm } from "@/features/accounts/components/user-form";
import type { ManageableUserDto } from "@/features/accounts/queries";
import { setUserActiveRuntimeAction } from "@/features/accounts/runtime-actions";

type Editor =
  | { kind: "create" }
  | { kind: "edit"; user: ManageableUserDto }
  | { kind: "memberships"; user: ManageableUserDto }
  | { kind: "reset-password"; user: ManageableUserDto }
  | null;

function editorTitle(editor: Exclude<Editor, null>): string {
  if (editor.kind === "create") return "新建账号";
  if (editor.kind === "edit") return `编辑 ${editor.user.username}`;
  if (editor.kind === "memberships") return `项目权限 · ${editor.user.displayName}`;
  return `重置密码 · ${editor.user.displayName}`;
}

export function UserManager({
  actorId,
  users,
  projects,
}: {
  actorId: number;
  users: readonly ManageableUserDto[];
  projects: readonly MembershipProjectOption[];
}) {
  const [editor, setEditor] = useState<Editor>(null);
  const [confirming, setConfirming] = useState<ManageableUserDto | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectById = new Map(projects.map((project) => [project.id, project]));

  function saved() {
    setEditor(null);
    window.location.reload();
  }

  async function setActive(user: ManageableUserDto, active: boolean) {
    setPendingId(user.id);
    setError(null);
    try {
      const result = await setUserActiveRuntimeAction({ userId: user.id, active });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    } catch {
      setError("系统暂时不可用，请稍后重试");
    } finally {
      setPendingId(null);
      setConfirming(null);
    }
  }

  return (
    <section className="management-panel" aria-labelledby="user-list-heading">
      <div className="management-panel__heading">
        <div>
          <h2 id="user-list-heading">账号列表</h2>
          <p>{users.length} 个账号，账号类型创建后不可修改。</p>
        </div>
        <Button onClick={() => setEditor({ kind: "create" })}>
          <Plus aria-hidden="true" size={17} />
          新建账号
        </Button>
      </div>

      {error ? (
        <div className="form-alert form-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {users.length === 0 ? (
        <div className="management-empty">
          <strong>还没有可管理账号</strong>
        </div>
      ) : (
        <div className="management-table-wrap">
          <table className="management-table management-table--users">
            <thead>
              <tr>
                <th scope="col">账号</th>
                <th scope="col">类型</th>
                <th scope="col">状态</th>
                <th scope="col">密码</th>
                <th scope="col">项目权限</th>
                <th scope="col"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const assignedProjects = user.projectIds
                  .map((projectId) => projectById.get(projectId))
                  .filter((project): project is MembershipProjectOption => Boolean(project));
                return (
                  <tr key={user.id} data-current-user={user.id === actorId || undefined}>
                    <td data-label="账号">
                      <strong>{user.displayName}</strong>
                      <span>@{user.username}{user.id === actorId ? " · 当前账号" : ""}</span>
                    </td>
                    <td data-label="类型">
                      <Badge tone={user.role === "DEVELOPER" ? "info" : "neutral"}>
                        {user.role === "DEVELOPER" ? "开发者" : "客户"}
                      </Badge>
                    </td>
                    <td data-label="状态">
                      <Badge tone={user.isActive ? "success" : "neutral"}>
                        {user.isActive ? "启用" : "已停用"}
                      </Badge>
                    </td>
                    <td data-label="密码">
                      <Badge tone={user.mustChangePassword ? "warning" : "neutral"}>
                        {user.mustChangePassword ? "需修改密码" : "密码已更新"}
                      </Badge>
                    </td>
                    <td data-label="项目权限" className="management-table__memberships">
                      {user.role === "DEVELOPER" ? (
                        <span>全部项目</span>
                      ) : assignedProjects.length > 0 ? (
                        <ul>
                          {assignedProjects.map((project) => (
                            <li key={project.id}>
                              {project.code} · {project.name}
                              {!project.isActive ? "（已停用）" : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span>未分配</span>
                      )}
                    </td>
                    <td data-label="操作">
                      <div className="management-row-actions">
                        <IconButton
                          label={`编辑账号 ${user.username}`}
                          icon={<Pencil aria-hidden="true" size={16} />}
                          disabled={pendingId === user.id}
                          onClick={() => setEditor({ kind: "edit", user })}
                        />
                        {user.role === "CUSTOMER" ? (
                          <IconButton
                            label={`设置 ${user.username} 的项目权限`}
                            icon={<FolderKey aria-hidden="true" size={16} />}
                            disabled={!user.isActive || pendingId === user.id}
                            onClick={() => setEditor({ kind: "memberships", user })}
                          />
                        ) : null}
                        <IconButton
                          label={`重置 ${user.username} 的密码`}
                          icon={<KeyRound aria-hidden="true" size={16} />}
                          disabled={pendingId === user.id}
                          onClick={() => setEditor({ kind: "reset-password", user })}
                        />
                        <IconButton
                          label={`${user.isActive ? "停用" : "启用"}账号 ${user.username}`}
                          icon={
                            user.isActive ? (
                              <PowerOff aria-hidden="true" size={16} />
                            ) : (
                              <Power aria-hidden="true" size={16} />
                            )
                          }
                          disabled={pendingId === user.id}
                          onClick={() => {
                            if (user.isActive) setConfirming(user);
                            else void setActive(user, true);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editor ? (
        <ManagementDialog
          title={editorTitle(editor)}
          onClose={() => setEditor(null)}
        >
            {editor.kind === "create" ? (
              <UserForm onCancel={() => setEditor(null)} onSaved={saved} />
            ) : editor.kind === "edit" ? (
              <UserForm user={editor.user} onCancel={() => setEditor(null)} onSaved={saved} />
            ) : editor.kind === "memberships" ? (
              <MembershipEditor
                user={editor.user}
                projects={projects}
                onCancel={() => setEditor(null)}
                onSaved={saved}
              />
            ) : (
              <ResetPasswordForm
                user={editor.user}
                onCancel={() => setEditor(null)}
                onSaved={saved}
              />
            )}
        </ManagementDialog>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirming)}
        title={confirming ? `停用账号 ${confirming.username}？` : "停用账号？"}
        description={
          confirming
            ? `${confirming.displayName} 将立即退出登录并失去系统访问权限。当前账号和最后一个启用的开发者不能停用。`
            : ""
        }
        confirmLabel="确认停用"
        destructive
        pending={confirming ? pendingId === confirming.id : false}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) void setActive(confirming, false);
        }}
      />
    </section>
  );
}
