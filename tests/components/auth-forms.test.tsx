/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/features/accounts/components/login-form";
import { LogoutForm } from "@/features/accounts/components/logout-form";
import { PasswordForm } from "@/features/accounts/components/password-form";

afterEach(cleanup);

describe("account forms", () => {
  it("offers a usable logout command on the forced-password screen", () => {
    render(<LogoutForm />);

    expect(screen.getByRole("form", { name: "退出登录" })).toBeVisible();
    expect(screen.getByRole("button", { name: "退出登录" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("keeps login intentionally role-free and reports the generic error", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "用户名或密码错误",
    });
    render(<LoginForm submitAction={action} />);

    expect(screen.queryByLabelText("用户类型")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "customer.one" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "not-correct" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码错误");
    expect(screen.getByLabelText("用户名")).toHaveValue("customer.one");
  });

  it("prevents a password change when the confirmation differs", async () => {
    const action = vi.fn();
    render(<PasswordForm submitAction={action} />);

    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: "current-password" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "different-password" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "修改密码" }));

    expect(await screen.findByText("两次输入的新密码不一致")).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });
});
