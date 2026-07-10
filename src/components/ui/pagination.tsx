import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

function pageHref(
  pathname: string,
  searchParams: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && key !== "page") params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function Pagination({
  pathname,
  searchParams,
  page,
  pageCount,
  total,
}: {
  pathname: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  pageCount: number;
  total: number;
}) {
  if (page > 1 && page > pageCount) {
    return (
      <nav className="pagination" aria-label="需求分页">
        <span>当前页没有内容，共 {total} 条</span>
        <div>
          <Link href={pageHref(pathname, searchParams, 1)} aria-label="回到第一页">
            <ChevronLeft aria-hidden="true" size={17} />
            回到第一页
          </Link>
        </div>
      </nav>
    );
  }
  if (pageCount <= 1) {
    return <p className="pagination-summary">共 {total} 条</p>;
  }
  return (
    <nav className="pagination" aria-label="需求分页">
      <span>第 {page} / {pageCount} 页，共 {total} 条</span>
      <div>
        {page > 1 ? (
          <Link href={pageHref(pathname, searchParams, page - 1)} aria-label="上一页">
            <ChevronLeft aria-hidden="true" size={17} />
            上一页
          </Link>
        ) : (
          <span aria-disabled="true"><ChevronLeft aria-hidden="true" size={17} />上一页</span>
        )}
        {page < pageCount ? (
          <Link href={pageHref(pathname, searchParams, page + 1)} aria-label="下一页">
            下一页
            <ChevronRight aria-hidden="true" size={17} />
          </Link>
        ) : (
          <span aria-disabled="true">下一页<ChevronRight aria-hidden="true" size={17} /></span>
        )}
      </div>
    </nav>
  );
}
