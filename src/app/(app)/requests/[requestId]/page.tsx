import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentUser } from "@/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { getRuntimeDatabase } from "@/db/runtime";
import { listAuthorizedAttachments } from "@/features/attachments/queries";
import {
  getOwnPrivateNote,
  listClarificationMessages,
  listPublicRemarks,
} from "@/features/communication/queries";
import { RequestDetail } from "@/features/requests/components/request-detail";
import { getRequestDetail } from "@/features/requests/queries";
import { parseRequestNumber } from "@/lib/request-number";

function routeRequestId(value: string): number | null {
  const number = parseRequestNumber(value);
  if (number !== null) return number;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ requestId: string }>;
}): Promise<Metadata> {
  const { requestId } = await params;
  return { title: requestId.toUpperCase() };
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const database = getRuntimeDatabase();
  const actor = await requireCurrentUser(database);
  const requestId = routeRequestId((await params).requestId);
  if (requestId === null) notFound();

  const request = getRequestDetail(database, actor, requestId);
  if (!request.ok) notFound();
  const attachments = listAuthorizedAttachments(database, actor, requestId);
  const remarks = listPublicRemarks(database, actor, requestId);
  const clarifications = listClarificationMessages(database, actor, requestId);
  if (!attachments.ok || !remarks.ok || !clarifications.ok) notFound();

  const privateNote =
    actor.role === "DEVELOPER"
      ? getOwnPrivateNote(database, actor, requestId)
      : null;
  if (privateNote && !privateNote.ok) notFound();

  return (
    <div className="page-stack page-stack--detail">
      <PageHeader
        eyebrow={`${request.data.project.code} · ${request.data.project.name}`}
        title={request.data.requestNumber}
        description="需求详情与沟通记录"
        actions={
          <Link href="/requests" className={buttonClassName({ variant: "quiet" })}>
            <ArrowLeft aria-hidden="true" size={17} />
            返回列表
          </Link>
        }
      />
      <RequestDetail
        actor={{ id: actor.id, role: actor.role }}
        request={request.data}
        attachments={attachments.data}
        remarks={remarks.data}
        clarifications={clarifications.data}
        privateNote={privateNote?.ok ? privateNote.data : undefined}
      />
    </div>
  );
}
