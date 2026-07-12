import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { getRuntimeDatabase } from "@/db/runtime";
import { DeveloperQuestionForm } from "@/features/developer-questions/components/question-form";
import { listManageableProjects } from "@/features/projects/queries";
export default async function NewQuestionPage() { const db = getRuntimeDatabase(); const actor = await requireCurrentUser(db); if (actor.role !== "DEVELOPER") notFound(); const projects = listManageableProjects(db, actor); if (!projects.ok) notFound(); return <div className="page-stack"><PageHeader title="新建开发者提问" description="针对项目向客户提出问题或设计思路。" /><DeveloperQuestionForm projects={projects.data.filter((p) => p.isActive).map(({ id, code, name }) => ({ id, code, name }))} /></div>; }
