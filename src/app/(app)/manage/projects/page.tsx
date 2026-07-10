import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthorizationError, requireDeveloper } from "@/auth/authorization";
import { requireCurrentUser } from "@/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { getRuntimeDatabase } from "@/db/runtime";
import { ProjectManager } from "@/features/projects/components/project-manager";
import { listManageableProjects } from "@/features/projects/queries";

export const metadata: Metadata = { title: "项目管理" };

export default async function ManageProjectsPage() {
  const database = getRuntimeDatabase();
  const actor = await requireCurrentUser(database);
  try {
    requireDeveloper(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  const result = listManageableProjects(database, actor);
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="开发者管理"
        title="项目管理"
        description="维护客户可提交需求的项目和启用状态。"
      />
      {result.ok ? (
        <ProjectManager projects={result.data} />
      ) : (
        <div className="form-alert form-alert--error" role="alert">
          {result.message}
        </div>
      )}
    </div>
  );
}
