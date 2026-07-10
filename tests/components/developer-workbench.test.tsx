/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "@/components/app-shell";
import { UserManager } from "@/features/accounts/components/user-manager";
import { ProjectManager } from "@/features/projects/components/project-manager";

afterEach(cleanup);

const now = new Date("2026-07-10T08:00:00.000Z");

describe("developer administration workbench", () => {
  it("restores developer-only project and account navigation", () => {
    render(
      <AppShell
        actor={{
          id: 8,
          username: "developer",
          displayName: "李开发",
          role: "DEVELOPER",
          mustChangePassword: false,
        }}
      >
        <p>页面内容</p>
      </AppShell>,
    );

    expect(screen.getAllByRole("link", { name: "项目管理" })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "账号管理" })).not.toHaveLength(0);
  });

  it("keeps management navigation hidden from customers", () => {
    render(
      <AppShell
        actor={{
          id: 9,
          username: "customer",
          displayName: "王客户",
          role: "CUSTOMER",
          mustChangePassword: false,
        }}
      >
        <p>页面内容</p>
      </AppShell>,
    );

    expect(screen.queryByRole("link", { name: "项目管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "账号管理" })).not.toBeInTheDocument();
  });

  it("shows compact project administration state", () => {
    render(
      <ProjectManager
        projects={[
          {
            id: 11,
            code: "PORTAL",
            name: "客户门户",
            description: "客户自助服务",
            isActive: false,
            createdAt: now,
            updatedAt: now,
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "项目列表" })).toBeInTheDocument();
    expect(screen.getByText("PORTAL")).toBeInTheDocument();
    expect(screen.getByText("客户门户")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
  });

  it("shows role, account state, forced-password state and memberships without secrets", () => {
    const unsafeUser = {
      id: 9,
      username: "customer",
      displayName: "王客户",
      role: "CUSTOMER" as const,
      isActive: true,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
      projectIds: [11],
      passwordHash: "must-not-render",
      privateNote: "A only secret note",
    };
    render(
      <UserManager
        actorId={8}
        projects={[
          { id: 11, code: "PORTAL", name: "客户门户", isActive: true },
          { id: 12, code: "OPS", name: "运营后台", isActive: false },
        ]}
        users={[unsafeUser]}
      />,
    );

    expect(screen.getByRole("heading", { name: "账号列表" })).toBeInTheDocument();
    expect(screen.getByText("客户")).toBeInTheDocument();
    expect(screen.getByText("启用")).toBeInTheDocument();
    expect(screen.getByText("需修改密码")).toBeInTheDocument();
    expect(screen.getByText("PORTAL · 客户门户")).toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
    expect(screen.queryByText("A only secret note")).not.toBeInTheDocument();
  });
});
