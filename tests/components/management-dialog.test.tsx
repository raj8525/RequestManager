/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ManagementDialog } from "@/components/management-dialog";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        编辑账号
      </button>
      {open ? (
        <ManagementDialog title="编辑客户" onClose={() => setOpen(false)}>
          <label htmlFor="dialog-name">显示名</label>
          <input id="dialog-name" />
          <button type="button" onClick={() => setOpen(false)}>
            取消
          </button>
          <button type="button">保存</button>
        </ManagementDialog>
      ) : null}
    </>
  );
}

describe("ManagementDialog", () => {
  it("moves focus inside, traps Tab in both directions and restores the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "编辑账号" });
    trigger.focus();
    fireEvent.click(trigger);

    const input = screen.getByLabelText("显示名");
    const save = screen.getByRole("button", { name: "保存" });
    expect(input).toHaveFocus();

    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the backdrop itself is clicked", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "编辑账号" }));
    const backdrop = container.querySelector(".management-dialog-backdrop");
    expect(backdrop).not.toBeNull();

    fireEvent.mouseDown(backdrop!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
