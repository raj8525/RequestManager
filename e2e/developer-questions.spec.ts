import { expect, loginAs, test } from "./fixtures";

test("developer question moves attention between customer and developer", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
  });
  await loginAs(page, "developerA");
  await page.goto("/questions/new");
  await page.getByLabel("项目").selectOption({ label: "PROJECT-A · Project A" });
  await page.getByLabel("提问内容").fill("请客户确认新版结算页的设计方向");
  await page.getByLabel("选择截图").setInputFiles("e2e/fixtures/screenshot.png");
  await page.getByRole("button", { name: "创建提问" }).click();
  await expect(page).toHaveURL(/\/questions\/ASK-\d+$/);
  const questionNumber = page.url().match(/(ASK-\d+)$/)?.[1];
  expect(questionNumber).toBeTruthy();

  await loginAs(page, "customerA");
  const customerRow = page.getByTestId(`question-row-${questionNumber}`);
  await expect(customerRow).toHaveAttribute("data-attention", "question-customer");
  await expect(customerRow).toContainText("待您回复");
  await customerRow.getByRole("link", { name: questionNumber! }).click();
  await page.getByLabel("回复开发者").fill("客户确认该方向可行，并附上参考截图。");
  await page.getByLabel("选择截图").setInputFiles("e2e/fixtures/screenshot.png");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("客户确认该方向可行，并附上参考截图。")).toBeVisible();
  await page.goto("/requests");
  await expect(page.getByTestId(`question-row-${questionNumber}`)).not.toHaveAttribute("data-attention", "question-customer");

  await loginAs(page, "developerA");
  const developerRow = page.getByTestId(`question-row-${questionNumber}`);
  await expect(developerRow).toHaveAttribute("data-attention", "question-developer");
  await developerRow.getByRole("link", { name: questionNumber! }).click();
  await expect(page.getByText("客户确认该方向可行，并附上参考截图。")).toBeVisible();
  await page.getByRole("button", { name: "标记已查看" }).click();
  await expect(page.getByText("已查看", { exact: true })).toBeVisible();
  await page.goto("/requests");
  await expect(page.getByTestId(`question-row-${questionNumber}`)).not.toHaveAttribute("data-attention", "question-developer");

  await loginAs(page, "customerA");
  await page.goto(`/questions/${questionNumber}`);
  await page.getByLabel("回复开发者").fill("再补充一个客户侧验证结果。");
  await page.getByRole("button", { name: "发送" }).click();
  await loginAs(page, "developerA");
  await expect(page.getByTestId(`question-row-${questionNumber}`)).toHaveAttribute("data-attention", "question-developer");
  await page.goto(`/questions/${questionNumber}`);
  await page.getByLabel("继续追问").fill("请项目中的另一位客户也确认。");
  await page.getByRole("button", { name: "发送" }).click();

  await loginAs(page, "customerB");
  await expect(page.getByTestId(`question-row-${questionNumber}`)).toHaveAttribute("data-attention", "question-customer");
  await loginAs(page, "unassignedCustomer");
  await page.goto(`/questions/${questionNumber}`);
  await expect(page.getByText("没有找到这项内容")).toBeVisible();
});
