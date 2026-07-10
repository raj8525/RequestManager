import { expect, fillHydrated, loginAs, test } from "./fixtures";

async function pasteScreenshot(page: import("@playwright/test").Page): Promise<void> {
  const screenshot = await import("node:fs/promises").then((fs) =>
    fs.readFile("e2e/fixtures/screenshot.png", "base64"),
  );
  await page.getByLabel("需求内容").evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const file = new File([bytes], "pasted-screenshot.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, screenshot);
}

test("runs the customer and developer request lifecycle with simple clarification", async ({
  page,
}) => {
  const content = `结算页面保存后金额显示错误 ${Date.now()}`;
  const editedContent = `${content}，刷新页面后仍可复现。`;
  const publicRemark = "已复现，修复将包含金额格式校验。";
  const privateNote = "开发者 A 私人排查笔记，不得发送给客户。";
  const firstQuestion = "请确认问题发生时使用的币种。";
  const customerReply = "使用人民币 CNY，可以稳定复现。";
  const secondQuestion = "请再确认是否开启了含税价格。";

  await loginAs(page, "customerA");
  await page.goto("/requests/new");
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
    page.getByLabel("添加客户可见备注").getByRole("textbox"),
    publicRemark,
  );
  await page.getByRole("button", { name: "添加备注" }).click();
  await expect(page.getByText(publicRemark)).toBeVisible();

  await fillHydrated(page.getByLabel("私人笔记内容"), privateNote);
  await page.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("status")).toContainText("笔记已保存");

  await fillHydrated(
    page.getByLabel("澄清消息").getByRole("textbox"),
    firstQuestion,
  );
  await page.getByRole("button", { name: "提出问题" }).click();
  await expect(page.getByText(firstQuestion)).toBeVisible();

  await loginAs(page, "customerB");
  await page.goto("/requests");
  const row = page.getByTestId(`request-row-${requestNumber}`);
  await expect(row).toHaveAttribute("data-attention", "customer-reply");
  await expect(row).toContainText("待您回复");
  await expect(page.locator(".request-table tbody tr").first()).toHaveAttribute(
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
  await page.getByRole("button", { name: "提交回复" }).click();
  await expect(page.getByText(customerReply)).toBeVisible();
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
  await expect(page.getByText(secondQuestion)).toBeVisible();
  await page.getByRole("button", { name: "暂停" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认暂停" }).click();
  await expect(page.getByText("已暂停", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByText("正常", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("正在等待客户回复")).toBeVisible();

  await page.getByRole("button", { name: "归档" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByText("已归档", { exact: true }).first()).toBeVisible();
  await page.goto("/requests?recordStatus=ARCHIVED");
  await expect(page.getByTestId(`request-row-${requestNumber}`)).toBeVisible();
  await expect(page.getByTestId(`request-row-${requestNumber}`)).toContainText("已归档");
});
