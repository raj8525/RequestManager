import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import type { RequestProjectOption } from "@/features/requests/components/request-form";

export type RequestFilterValues = {
  search?: string;
  projectId?: string;
  requestType?: string;
  priority?: string;
  progressStatus?: string;
  recordStatus?: string;
  sort?: string;
  direction?: string;
};

export function RequestToolbar({
  projects,
  values,
}: {
  projects: readonly RequestProjectOption[];
  values: RequestFilterValues;
}) {
  return (
    <form className="request-toolbar" action="/requests" method="get" aria-label="需求筛选">
      {values.sort ? <input type="hidden" name="sort" value={values.sort} /> : null}
      {values.direction ? <input type="hidden" name="direction" value={values.direction} /> : null}
      <label className="request-toolbar__search">
        <span className="sr-only">搜索需求</span>
        <Search aria-hidden="true" size={17} />
        <input
          name="search"
          type="search"
          placeholder="搜索编号或需求内容"
          aria-label="搜索需求"
          defaultValue={values.search}
        />
      </label>
      <label>
        <span className="sr-only">项目</span>
        <select name="projectId" aria-label="按项目筛选" defaultValue={values.projectId ?? ""}>
          <option value="">全部项目</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>{project.code} · {project.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">类型</span>
        <select name="requestType" aria-label="按类型筛选" defaultValue={values.requestType ?? ""}>
          <option value="">全部类型</option>
          <option value="BUG">Bug</option>
          <option value="CHANGE">功能变更</option>
          <option value="NEW_FEATURE">新增功能</option>
        </select>
      </label>
      <label>
        <span className="sr-only">优先级</span>
        <select name="priority" aria-label="按优先级筛选" defaultValue={values.priority ?? ""}>
          <option value="">全部优先级</option>
          <option value="URGENT">加急</option>
          <option value="IMPORTANT">重要</option>
          <option value="NORMAL">普通</option>
        </select>
      </label>
      <label>
        <span className="sr-only">进度</span>
        <select name="progressStatus" aria-label="按进度筛选" defaultValue={values.progressStatus ?? ""}>
          <option value="">全部进度</option>
          <option value="UNSCHEDULED">未排期</option>
          <option value="SCHEDULED">已排期</option>
          <option value="COMPLETED">完成</option>
        </select>
      </label>
      <label>
        <span className="sr-only">记录状态</span>
        <select name="recordStatus" aria-label="按记录状态筛选" defaultValue={values.recordStatus ?? ""}>
          <option value="">默认（不含归档）</option>
          <option value="ACTIVE">正常</option>
          <option value="PAUSED">已暂停</option>
          <option value="ARCHIVED">已归档</option>
        </select>
      </label>
      <button type="submit" className={buttonClassName({ size: "small" })}>
        <Search aria-hidden="true" size={15} />
        筛选
      </button>
      <Link
        href="/requests"
        className={buttonClassName({ variant: "quiet", size: "small" })}
        title="清除筛选"
      >
        <RotateCcw aria-hidden="true" size={15} />
        清除
      </Link>
    </form>
  );
}
