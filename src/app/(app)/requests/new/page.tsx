import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { getRuntimeDatabase } from "@/db/runtime";
import { listAccessibleProjects } from "@/features/projects/queries";
import { RequestForm } from "@/features/requests/components/request-form";

export const metadata: Metadata = { title: "新建需求" };

export default async function NewRequestPage() {
  const database = getRuntimeDatabase();
  const actor = await requireCurrentUser(database);
  if (actor.role !== "CUSTOMER") notFound();
  const result = listAccessibleProjects(database, actor);
  if (!result.ok) notFound();
  const projects = result.data
    .filter((project) => project.isActive)
    .map(({ id, code, name }) => ({ id, code, name }));

  return (
    <div className="page-stack page-stack--form">
      <PageHeader
        eyebrow="客户提交"
        title="新建需求"
        description="写清需求内容，并在需要时粘贴或选择截图。"
        actions={
          <Link href="/requests" className={buttonClassName({ variant: "quiet" })}>
            <ArrowLeft aria-hidden="true" size={17} />
            返回列表
          </Link>
        }
      />
      <RequestForm mode="create" projects={projects} />
    </div>
  );
}
