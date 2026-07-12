"use client";
import { CheckCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { markDeveloperQuestionSeenRuntimeAction } from "../runtime-actions";
export function MarkSeenButton({ questionId, version }: { questionId: number; version: number }) {
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  return <div>{error ? <p className="field__error" role="alert">{error}</p> : null}<Button disabled={pending} onClick={async () => { setPending(true); const result = await markDeveloperQuestionSeenRuntimeAction(questionId, version); if (!result.ok) { setError(result.message); setPending(false); } else window.location.reload(); }}><CheckCheck size={17} />{pending ? "正在处理" : "标记已查看"}</Button></div>;
}
