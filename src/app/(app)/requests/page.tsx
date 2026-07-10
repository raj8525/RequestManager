import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { requireCurrentUser } from "@/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import {
  requestPriorities,
  requestProgressStatuses,
  requestRecordStatuses,
  requestTypes,
} from "@/db/schema";
import { getRuntimeDatabase } from "@/db/runtime";
import { listAccessibleProjects } from "@/features/projects/queries";
import { RequestList } from "@/features/requests/components/request-list";
import {
  RequestToolbar,
  type RequestFilterValues,
} from "@/features/requests/components/request-toolbar";
import { listRequests } from "@/features/requests/queries";
import type { ListRequestsInput } from "@/features/requests/schemas";

export const metadata: Metadata = { title: "需求列表" };

type SearchParams = Record<string, string | string[] | undefined>;

function valueOf(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends readonly string[]>(
  values: T,
  value: string | undefined,
): T[number] | undefined {
  return value && (values as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const database = getRuntimeDatabase();
  const actor = await requireCurrentUser(database);
  const raw = await searchParams;
  const projectIdValue = Number(valueOf(raw, "projectId"));
  const pageValue = Number(valueOf(raw, "page"));
  const requestType = oneOf(requestTypes, valueOf(raw, "requestType"));
  const priority = oneOf(requestPriorities, valueOf(raw, "priority"));
  const progressStatus = oneOf(
    requestProgressStatuses,
    valueOf(raw, "progressStatus"),
  );
  const recordStatus = oneOf(
    requestRecordStatuses,
    valueOf(raw, "recordStatus"),
  );
  const values: RequestFilterValues = {
    search: valueOf(raw, "search")?.trim() || undefined,
    projectId: Number.isSafeInteger(projectIdValue) && projectIdValue > 0
      ? String(projectIdValue)
      : undefined,
    requestType,
    priority,
    progressStatus,
    recordStatus,
  };
  const filters: ListRequestsInput = {
    ...(values.search ? { search: values.search } : {}),
    ...(values.projectId ? { projectId: Number(values.projectId) } : {}),
    ...(requestType ? { requestType } : {}),
    ...(priority ? { priority } : {}),
    ...(progressStatus ? { progressStatus } : {}),
    ...(recordStatus ? { recordStatus } : {}),
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    pageSize: 25,
  };
  const requestResult = listRequests(database, actor, filters);
  const projectResult = listAccessibleProjects(database, actor);
  if (!requestResult.ok || !projectResult.ok) {
    const message = !requestResult.ok
      ? requestResult.message
      : !projectResult.ok
        ? projectResult.message
        : "需求列表暂时无法加载";
    return (
      <div className="page-stack">
        <PageHeader title="需求列表" />
        <div className="form-alert form-alert--error" role="alert">
          {message}
        </div>
      </div>
    );
  }

  const projectOptions = projectResult.data.map(({ id, code, name }) => ({ id, code, name }));
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={actor.role === "CUSTOMER" ? "客户工作区" : "开发者工作区"}
        title="需求列表"
        description={
          actor.role === "CUSTOMER"
            ? "待您回复的需求会优先显示。"
            : "查看并处理全部项目中的客户需求。"
        }
        actions={
          actor.role === "CUSTOMER" ? (
            <Link href="/requests/new" className={buttonClassName()}>
              <Plus aria-hidden="true" size={17} />
              新建需求
            </Link>
          ) : null
        }
      />
      <RequestToolbar projects={projectOptions} values={values} />
      <RequestList
        role={actor.role}
        actorId={actor.id}
        items={requestResult.data.items}
      />
      <Pagination
        pathname="/requests"
        searchParams={values}
        page={requestResult.data.page}
        pageCount={requestResult.data.pageCount}
        total={requestResult.data.total}
      />
    </div>
  );
}
