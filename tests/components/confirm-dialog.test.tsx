/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/confirm-dialog";

afterEach(cleanup);

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开确认框
      </button>
      <ConfirmDialog
        open={open}
        title="确认操作"
        description="请确认是否继续。"
        confirmLabel="确认"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("traps forward and backward focus inside the open dialog", () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole("button", { name: "打开确认框" }));

    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确认" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
  });

  it("closes on Escape and restores the element focused before opening", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "打开确认框" });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("cannot be cancelled while its action is pending", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open
        pending
        title="确认操作"
        description="请确认是否继续。"
        confirmLabel="确认"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".dialog-backdrop");
    expect(backdrop).not.toBeNull();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveFocus();

    fireEvent.mouseDown(backdrop!);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在处理" })).toBeDisabled();
  });
});
