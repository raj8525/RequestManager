"use client";

import { Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ManagementDialog } from "@/components/management-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { Project } from "@/db/types";
import { ProjectForm } from "@/features/projects/components/project-form";
import { setProjectActiveRuntimeAction } from "@/features/projects/runtime-actions";

type Editor = { kind: "create" } | { kind: "edit"; project: Project } | null;

export function ProjectManager({ projects }: { projects: readonly Project[] }) {
  const [editor, setEditor] = useState<Editor>(null);
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function saved() {
    setEditor(null);
    window.location.reload();
  }

  async function setActive(project: Project, active: boolean) {
    setPendingId(project.id);
    setError(null);
    try {
      const result = await setProjectActiveRuntimeAction({
        projectId: project.id,
        active,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    } catch {
      setError("系统暂时不可用，请稍后重试");
    } finally {
      setPendingId(null);
      setConfirming(null);
    }
  }

  return (
    <section className="management-panel" aria-labelledby="project-list-heading">
      <div className="management-panel__heading">
        <div>
          <h2 id="project-list-heading">项目列表</h2>
          <p>{projects.length} 个项目，停用后已有需求仍可查看。</p>
        </div>
        <Button onClick={() => setEditor({ kind: "create" })}>
          <Plus aria-hidden="true" size={17} />
          新建项目
        </Button>
      </div>

      {error ? (
        <div className="form-alert form-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="management-empty">
          <strong>还没有项目</strong>
          <span>创建第一个项目后即可分配客户账号。</span>
        </div>
      ) : (
        <div className="management-table-wrap">
          <table className="management-table management-table--projects">
            <thead>
              <tr>
                <th scope="col">项目</th>
                <th scope="col">说明</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td data-label="项目">
                    <strong>{project.code}</strong>
                    <span>{project.name}</span>
                  </td>
                  <td data-label="说明" className="management-table__description">
                    {project.description || "未填写说明"}
                  </td>
                  <td data-label="状态">
                    <Badge tone={project.isActive ? "success" : "neutral"}>
                      {project.isActive ? "启用" : "已停用"}
                    </Badge>
                  </td>
                  <td data-label="操作">
                    <div className="management-row-actions">
                      <IconButton
                        label={`编辑项目 ${project.code}`}
                        icon={<Pencil aria-hidden="true" size={16} />}
                        disabled={pendingId === project.id}
                        onClick={() => setEditor({ kind: "edit", project })}
                      />
                      <IconButton
                        label={`${project.isActive ? "停用" : "启用"}项目 ${project.code}`}
                        icon={
                          project.isActive ? (
                            <PowerOff aria-hidden="true" size={16} />
                          ) : (
                            <Power aria-hidden="true" size={16} />
                          )
                        }
                        disabled={pendingId === project.id}
                        onClick={() => {
                          if (project.isActive) setConfirming(project);
                          else void setActive(project, true);
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor ? (
        <ManagementDialog
          title={editor.kind === "create" ? "新建项目" : `编辑 ${editor.project.code}`}
          onClose={() => setEditor(null)}
        >
            <ProjectForm
              project={editor.kind === "edit" ? editor.project : undefined}
              onCancel={() => setEditor(null)}
              onSaved={saved}
            />
        </ManagementDialog>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirming)}
        title={confirming ? `停用项目 ${confirming.code}？` : "停用项目？"}
        description={
          confirming
            ? `${confirming.name} 将不能接收新需求，已有需求仍保持可查。`
            : ""
        }
        confirmLabel="确认停用"
        destructive
        pending={confirming ? pendingId === confirming.id : false}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) void setActive(confirming, false);
        }}
      />
    </section>
  );
}
