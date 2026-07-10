import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthorizationError, requireDeveloper } from "@/auth/authorization";
import { requireCurrentUser } from "@/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { getRuntimeDatabase } from "@/db/runtime";
import { UserManager } from "@/features/accounts/components/user-manager";
import { listManageableUsersWithMemberships } from "@/features/accounts/queries";
import { listManageableProjects } from "@/features/projects/queries";

export const metadata: Metadata = { title: "账号管理" };

export default async function ManageUsersPage() {
  const database = getRuntimeDatabase();
  const actor = await requireCurrentUser(database);
  try {
    requireDeveloper(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  const usersResult = listManageableUsersWithMemberships(database, actor);
  const projectsResult = listManageableProjects(database, actor);
  if (!usersResult.ok || !projectsResult.ok) {
    const message = !usersResult.ok
      ? usersResult.message
      : !projectsResult.ok
        ? projectsResult.message
        : "账号列表暂时无法加载";
    return (
      <div className="page-stack">
        <PageHeader eyebrow="开发者管理" title="账号管理" />
        <div className="form-alert form-alert--error" role="alert">
          {message}
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="开发者管理"
        title="账号管理"
        description="创建账号、重置临时密码并分配客户项目权限。"
      />
      <UserManager
        actorId={actor.id}
        users={usersResult.data}
        projects={projectsResult.data.map(({ id, code, name, isActive }) => ({
          id,
          code,
          name,
          isActive,
        }))}
      />
    </div>
  );
}
