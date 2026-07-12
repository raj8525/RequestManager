import type { DeveloperQuestion } from "@/db/types";
import { formatQuestionNumber } from "@/lib/question-number";

export type DeveloperQuestionDto = {
  id: number;
  questionNumber: string;
  projectId: number;
  createdById: number;
  content: string;
  summary: string;
  attentionStatus: DeveloperQuestion["attentionStatus"];
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export function presentDeveloperQuestion(question: DeveloperQuestion): DeveloperQuestionDto {
  return {
    id: question.id,
    questionNumber: formatQuestionNumber(question.id),
    projectId: question.projectId,
    createdById: question.createdById,
    content: question.content,
    summary: question.content.replace(/\s+/g, " ").trim().slice(0, 60),
    attentionStatus: question.attentionStatus,
    version: question.version,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}
