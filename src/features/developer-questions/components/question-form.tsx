"use client";

import { MessageSquarePlus, Send } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScreenshotInput } from "@/features/attachments/screenshot-input";

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `question-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function DeveloperQuestionForm({ projects, question, role }: { projects?: Array<{ id: number; code: string; name: string }>; question?: { id: number; questionNumber: string; version: number }; role?: "CUSTOMER" | "DEVELOPER" }) {
  const [files, setFiles] = useState<File[]>([]); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(createIdempotencyKey());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; setPending(true); setError(null);
    try {
      const form = new FormData(event.currentTarget); form.set("idempotencyKey", idempotencyKey.current); for (const file of files) form.append("attachments", file);
      if (question) form.set("expectedVersion", String(question.version));
      const url = question ? `/api/developer-questions/${question.questionNumber}/messages` : "/api/developer-questions";
      const response = await fetch(url, { method: "POST", body: form }); const result = await response.json(); if (!result.ok) { setError(result.message); return; } window.location.assign(question ? `/questions/${question.questionNumber}` : `/questions/${result.data.questionNumber}`);
    } catch { setError("系统暂时不可用，请稍后重试"); } finally { setPending(false); }
  }
  return <form className="question-form" onSubmit={submit} data-screenshot-paste-target="true">
    {error ? <div className="form-alert form-alert--error" role="alert">{error}</div> : null}
    {projects ? <label className="field"><span className="field__label">项目</span><select name="projectId" aria-label="项目" required defaultValue=""><option value="" disabled>选择项目</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label> : null}
    <label className="field"><span className="field__label">{question ? (role === "CUSTOMER" ? "回复开发者" : "继续追问") : "提问内容"}</span><textarea name="content" aria-label={question ? (role === "CUSTOMER" ? "回复开发者" : "继续追问") : "提问内容"} required maxLength={10000} /></label>
    <ScreenshotInput value={files} onChange={setFiles} disabled={pending} />
    <div className="form-actions"><Button type="submit" disabled={pending}>{question ? <Send size={17} /> : <MessageSquarePlus size={17} />}{pending ? "正在提交" : question ? "发送" : "创建提问"}</Button></div>
  </form>;
}
