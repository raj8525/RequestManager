import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="centered-state">
      <p className="centered-state__code">404</p>
      <h1>没有找到这项内容</h1>
      <p>记录可能不存在，或您没有查看权限。</p>
      <Link href="/requests" className={buttonClassName({ variant: "secondary" })}>
        <ArrowLeft aria-hidden="true" size={17} />
        返回需求列表
      </Link>
    </main>
  );
}
