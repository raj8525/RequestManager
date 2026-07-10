"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, fieldDescriptionIds } from "@/components/ui/field";
import type { Project } from "@/db/types";
import {
  createProjectRuntimeAction,
  updateProjectRuntimeAction,
} from "@/features/projects/runtime-actions";

export function ProjectForm({
  project,
  onCancel,
  onSaved,
}: {
  project?: Project;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const prefix = project ? `project-${project.id}` : "project-new";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const input = {
        code: String(values.get("code") ?? ""),
        name: String(values.get("name") ?? ""),
        description: String(values.get("description") ?? ""),
      };
      const result = project
        ? await updateProjectRuntimeAction({ projectId: project.id, ...input })
        : await createProjectRuntimeAction(input);
      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onSaved();
    } catch {
      setError("系统暂时不可用，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="management-form" onSubmit={submit} noValidate>
      {error ? (
        <div className="form-alert form-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="management-form__grid">
        <Field
          label="项目编号"
          htmlFor={`${prefix}-code`}
          required
          error={fieldErrors.code?.[0]}
          hint="用于列表与需求编号，建议使用简短英文或数字。"
        >
          <input
            id={`${prefix}-code`}
            name="code"
            defaultValue={project?.code ?? ""}
            autoComplete="off"
            disabled={pending}
            aria-describedby={fieldDescriptionIds(`${prefix}-code`, {
              hint: true,
              error: Boolean(fieldErrors.code?.[0]),
            })}
          />
        </Field>
        <Field
          label="项目名称"
          htmlFor={`${prefix}-name`}
          required
          error={fieldErrors.name?.[0]}
        >
          <input
            id={`${prefix}-name`}
            name="name"
            defaultValue={project?.name ?? ""}
            disabled={pending}
            aria-describedby={fieldDescriptionIds(`${prefix}-name`, {
              error: Boolean(fieldErrors.name?.[0]),
            })}
          />
        </Field>
      </div>
      <Field
        label="项目说明"
        htmlFor={`${prefix}-description`}
        error={fieldErrors.description?.[0]}
      >
        <textarea
          id={`${prefix}-description`}
          name="description"
          defaultValue={project?.description ?? ""}
          disabled={pending}
          aria-describedby={fieldDescriptionIds(`${prefix}-description`, {
            error: Boolean(fieldErrors.description?.[0]),
          })}
        />
      </Field>
      <div className="management-form__actions">
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "正在保存" : project ? "保存项目" : "创建项目"}
        </Button>
      </div>
    </form>
  );
}
