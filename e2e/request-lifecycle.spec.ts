import { expect, fillHydrated, loginAs, test } from "./fixtures";

async function pasteScreenshot(
  page: import("@playwright/test").Page,
  target = page.getByLabel("需求内容"),
  fileName = "pasted-screenshot.png",
): Promise<void> {
  const screenshot = await import("node:fs/promises").then((fs) =>
    fs.readFile("e2e/fixtures/screenshot.png", "base64"),
  );
  await target.evaluate((element, { base64, fileName }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const file = new File([bytes], fileName, { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, { base64: screenshot, fileName });
}

test("fills a legacy request title once without exposing other edit fields", async ({ page }) => {
  await loginAs(page, "customerA");
  await page.goto("/requests?recordStatus=ARCHIVED");
  const legacyRow = page.getByTestId("request-row-REQ-000001");
  await expect(legacyRow.getByRole("link", { name: "待补充标题" })).toBeVisible();
  await legacyRow.getByRole("link", { name: "补充标题", exact: true }).click();
  await expect(page.getByRole("form", { name: "补充标题" })).toBeVisible();
  await expect(page.getByLabel("需求内容")).toHaveCount(0);
  await page.getByRole("textbox", { name: "标题", exact: true }).fill("历史需求标题已补齐");
  await page.getByRole("button", { name: "保存标题" }).click();
  await expect(page.getByRole("heading", { name: "历史需求标题已补齐" })).toBeVisible();
  await page.goto("/requests?recordStatus=ARCHIVED");
  await expect(legacyRow.getByRole("link", { name: "历史需求标题已补齐" })).toBeVisible();
  await expect(legacyRow.getByRole("button", { name: "编辑" })).toBeDisabled();
});

test("runs the customer and developer request lifecycle with simple clarification", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const content = `结算页面保存后金额显示错误 ${Date.now()}`;
  const title = "结算页面金额显示错误";
  const editedContent = `${content}，刷新页面后仍可复现。`;
  const publicRemark = "已复现，修复将包含金额格式校验。";
  const privateNote = "开发者 A 私人排查笔记，不得发送给客户。";
  const firstQuestion = "请确认问题发生时使用的币种。";
  const customerReply = "使用人民币 CNY，可以稳定复现。";
  const secondQuestion = "请再确认是否开启了含税价格。";

  await loginAs(page, "customerA");
  await page.goto("/requests/new");
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("需求内容").fill(content);
  await page.getByLabel("需求类型").selectOption({ label: "Bug" });
  await page.getByLabel("优先级").selectOption({ label: "加急" });
  await pasteScreenshot(page);
  await expect(page.getByRole("list", { name: "待上传截图" })).toContainText(
    "pasted-screenshot.png",
  );
  await page.getByRole("button", { name: "提交需求" }).click();
  await expect(page).toHaveURL(/\/requests\/REQ-\d+$/);
  const requestNumber = page.url().match(/(REQ-\d+)$/)?.[1];
  expect(requestNumber).toBeTruthy();

  await page.goto("/requests");
  const createdRow = page.getByTestId(`request-row-${requestNumber}`);
  await expect(createdRow.getByRole("link", { name: title })).toBeVisible();
  const createdCells = createdRow.getByRole("cell");
  await expect(createdCells.first().getByRole("link", { name: "编辑" })).toHaveCount(0);
  await expect(createdCells.last().getByRole("link", { name: "编辑" })).toBeVisible();
  const requestTable = createdRow.locator("xpath=ancestor::table");
  await requestTable.getByRole("columnheader", { name: /更新时间/ }).getByRole("link").click();
  await expect(page).toHaveURL(/sort=updatedAt&direction=desc/);
  await expect(requestTable.getByRole("columnheader", { name: /更新时间/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await requestTable.getByRole("columnheader", { name: /更新时间/ }).getByRole("link").click();
  await expect(page).toHaveURL(/sort=updatedAt&direction=asc/);
  await page.goto(`/requests/${requestNumber}`);

  await page.getByRole("button", { name: "放大查看 pasted-screenshot.png" }).click();
  const imagePreview = page.getByRole("dialog", { name: "截图预览" });
  await expect(imagePreview.getByAltText("pasted-screenshot.png")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestNumber}$`));
  await page.keyboard.press("Escape");
  await expect(imagePreview).toHaveCount(0);

  await page.getByRole("link", { name: "编辑" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("需求内容").fill(editedContent);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText(editedContent)).toBeVisible();

  await loginAs(page, "developerA");
  await page.goto(`/requests/${requestNumber}`);
  await page.getByLabel("更新进度").selectOption("SCHEDULED");
  await expect(page.getByLabel("更新进度")).toHaveValue("SCHEDULED");

  await fillHydrated(
    page.getByLabel("添加备注").getByRole("textbox"),
    publicRemark,
  );
  await pasteScreenshot(
    page,
    page.getByLabel("添加备注").getByRole("textbox"),
    "remark-proof.png",
  );
  await page.getByRole("button", { name: "添加备注" }).click();
  const publicRemarkItem = page.locator(".message-item", { hasText: publicRemark });
  await expect(publicRemarkItem).toBeVisible();
  await expect(publicRemarkItem.getByAltText("remark-proof.png")).toBeVisible();

  await fillHydrated(page.getByLabel("私人笔记内容"), privateNote);
  await page.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("status")).toContainText("笔记已保存");

  await fillHydrated(
    page.getByLabel("澄清消息").getByRole("textbox"),
    firstQuestion,
  );
  await pasteScreenshot(
    page,
    page.getByLabel("澄清消息").getByRole("textbox"),
    "developer-question.png",
  );
  const clarificationResponse = page.waitForResponse((response) =>
    response.url().includes("/clarifications"),
  );
  await page.getByRole("button", { name: "提出问题" }).click();
  await clarificationResponse;
  const firstQuestionItem = page.locator(".message-item", { hasText: firstQuestion });
  await expect(firstQuestionItem).toBeVisible();
  await expect(firstQuestionItem.getByAltText("developer-question.png")).toBeVisible();

  await loginAs(page, "customerB");
  await page.goto("/requests");
  const row = page.getByTestId(`request-row-${requestNumber}`);
  await expect(row).toHaveAttribute("data-attention", "customer-reply");
  await expect(row).toContainText("待您回复");
  await expect(row.locator("xpath=ancestor::table").locator("tbody tr").first()).toHaveAttribute(
    "data-testid",
    `request-row-${requestNumber}`,
  );
  await row.getByRole("link", { name: requestNumber! }).click();
  await expect(page.getByText(publicRemark)).toBeVisible();
  await expect(page.getByText(privateNote)).toHaveCount(0);
  await fillHydrated(
    page.getByLabel("澄清消息").getByRole("textbox"),
    customerReply,
  );
  await pasteScreenshot(
    page,
    page.getByLabel("澄清消息").getByRole("textbox"),
    "customer-reply.png",
  );
  await page.getByRole("button", { name: "提交回复" }).click();
  const customerReplyItem = page.locator(".message-item", { hasText: customerReply });
  await expect(customerReplyItem).toBeVisible();
  await expect(customerReplyItem.getByAltText("customer-reply.png")).toBeVisible();
  await page.goto("/requests");
  await expect(page.getByTestId(`request-row-${requestNumber}`)).not.toHaveAttribute(
    "data-attention",
    "customer-reply",
  );

  await loginAs(page, "developerA");
  await page.goto(`/requests/${requestNumber}`);
  await fillHydrated(
    page.getByLabel("澄清消息").getByRole("textbox"),
    secondQuestion,
  );
  await page.getByRole("button", { name: "提出问题" }).click();
  await expect(page.locator(".message-item", { hasText: secondQuestion })).toBeVisible();
  await page.getByRole("button", { name: "暂停" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认暂停" }).click();
  await expect(page.getByText("已暂停", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByText("正常", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("正在等待客户回复")).toBeVisible();

  await page.getByLabel("更新进度").selectOption("COMPLETED");
  const completionDialog = page.getByRole("dialog", { name: "将需求设为完成" });
  await expect(completionDialog).toBeVisible();
  await completionDialog.getByLabel("完成说明（可选）").fill("已完成修复并通过回归验证。");
  await pasteScreenshot(
    page,
    completionDialog.getByLabel("完成说明（可选）"),
    "completion-proof.png",
  );
  await completionDialog.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByLabel("更新进度")).toHaveValue("COMPLETED");
  await expect(page.getByLabel("完成说明（可选）")).toHaveValue("已完成修复并通过回归验证。");
  await expect(page.getByAltText("completion-proof.png")).toBeVisible();

  await loginAs(page, "customerA");
  await page.goto(`/requests/${requestNumber}`);
  await page.getByRole("button", { name: "重新打开" }).click();
  const reopenDialog = page.getByRole("dialog", { name: "重新打开这条需求" });
  await expect(reopenDialog.getByRole("button", { name: "确认重新打开" })).toBeDisabled();
  await fillHydrated(
    reopenDialog.getByLabel("重新打开原因"),
    "验收后发现原问题仍然可以复现。",
  );
  await pasteScreenshot(
    page,
    reopenDialog.getByLabel("重新打开原因"),
    "reopen-proof.png",
  );
  await reopenDialog.getByRole("button", { name: "确认重新打开" }).click();
  await expect(page.getByText("未排期", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "编辑" })).toBeVisible();
  const reopenMessage = page.locator(".message-item", {
    hasText: "验收后发现原问题仍然可以复现。",
  });
  await expect(reopenMessage).toContainText("客户重新打开");
  await expect(reopenMessage.getByAltText("reopen-proof.png")).toBeVisible();
  await expect(page.getByText("已完成修复并通过回归验证。")).toBeVisible();
  await expect(page.getByAltText("completion-proof.png")).toBeVisible();

  await loginAs(page, "developerA");
  await page.goto(`/requests/${requestNumber}`);
  await page.getByLabel("更新进度").selectOption("SCHEDULED");
  await expect(page.getByLabel("更新进度")).toHaveValue("SCHEDULED");
  await expect(page.getByLabel("完成说明（可选）")).toHaveValue("已完成修复并通过回归验证。");

  await page.getByRole("button", { name: "归档" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByText("已归档", { exact: true }).first()).toBeVisible();
  await page.goto("/requests?recordStatus=ARCHIVED");
  await expect(page.getByTestId(`request-row-${requestNumber}`)).toBeVisible();
  await expect(page.getByTestId(`request-row-${requestNumber}`)).toContainText("已归档");
});
