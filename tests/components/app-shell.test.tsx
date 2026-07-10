/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "@/components/app-shell";

afterEach(cleanup);

describe("AppShell", () => {
  it("shows developer management routes after their screens exist", () => {
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

    expect(screen.getAllByRole("link", { name: "需求列表" })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "项目管理" })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "账号管理" })).not.toHaveLength(0);
  });
});
