import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { getRuntimeDatabase } from "@/db/runtime";
import { listAuthorizedAttachments } from "@/features/attachments/queries";
import { RequestForm } from "@/features/requests/components/request-form";
import { canEditRequest, canFillLegacyRequestTitle } from "@/features/requests/policy";
import { getRequestDetail } from "@/features/requests/queries";
import { parseRequestNumber } from "@/lib/request-number";

export const metadata: Metadata = { title: "编辑需求" };

export default async function EditRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const database = getRuntimeDatabase();
  const actor = await requireCurrentUser(database);
  const value = (await params).requestId;
  const requestId = parseRequestNumber(value) ?? Number(value);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) notFound();
  const result = getRequestDetail(database, actor, requestId);
  const canEdit = result.ok && canEditRequest(actor, result.data);
  const canFillTitle = result.ok && canFillLegacyRequestTitle(actor, result.data);
  if (
    !result.ok ||
    !result.data.project.isActive ||
    (!canEdit && !canFillTitle)
  ) {
    notFound();
  }
  const attachments = listAuthorizedAttachments(database, actor, requestId);
  if (!attachments.ok) notFound();

  return (
    <div className="page-stack page-stack--form">
      <PageHeader
        eyebrow={result.data.requestNumber}
        title={canFillTitle ? "补充标题" : "编辑需求"}
        description={canFillTitle ? "为历史需求补充一次标题，原内容和状态保持不变。" : "只有正常且未排期的本人需求可以修改。"}
        actions={
          <Link
            href={`/requests/${result.data.requestNumber}`}
            className={buttonClassName({ variant: "quiet" })}
          >
            <ArrowLeft aria-hidden="true" size={17} />
            返回详情
          </Link>
        }
      />
      <RequestForm
        mode={canFillTitle ? "fill-title" : "edit"}
        projects={[result.data.project]}
        initialRequest={result.data}
        initialAttachments={canFillTitle ? [] : attachments.data}
      />
    </div>
  );
}
