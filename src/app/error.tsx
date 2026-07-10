"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("RequestManager page error", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="centered-state">
      <p className="centered-state__code">出错了</p>
      <h1>页面暂时无法加载</h1>
      <p>请重试；若问题持续出现，请联系开发者检查运行日志。</p>
      <Button onClick={reset}>
        <RefreshCw aria-hidden="true" size={17} />
        重新加载
      </Button>
    </main>
  );
}
