import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "e2e secure password";

export const accounts = {
  developerA: "developer-a",
  developerB: "developer-b",
  customerA: "customer-a",
  customerB: "customer-b",
  unassignedCustomer: "unassigned-customer",
} as const;

export type AccountName = keyof typeof accounts;

export async function fillHydrated(locator: Locator, value: string): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
  await locator.fill(value);
}

export async function loginAs(
  page: Page,
  account: AccountName,
  password = E2E_PASSWORD,
): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("用户名").fill(accounts[account]);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(requests|account\/password)$/);
}

export async function createRequest(
  page: Page,
  options: {
    content: string;
    withScreenshot?: boolean;
    requestType?: "Bug" | "功能变更" | "新增功能";
    priority?: "加急" | "重要" | "普通";
  },
): Promise<string> {
  await page.goto("/requests/new");
  await page.getByLabel("需求内容").fill(options.content);
  await page
    .getByLabel("需求类型")
    .selectOption({ label: options.requestType ?? "Bug" });
  await page
    .getByLabel("优先级")
    .selectOption({ label: options.priority ?? "普通" });
  if (options.withScreenshot) {
    await page.getByLabel("选择截图").setInputFiles("e2e/fixtures/screenshot.png");
    await expect(page.getByRole("list", { name: "待上传截图" })).toBeVisible();
  }
  await page.getByRole("button", { name: "提交需求" }).click();
  await expect(page).toHaveURL(/\/requests\/REQ-\d+$/);
  const match = page.url().match(/(REQ-\d+)$/);
  if (!match) throw new Error("Created request URL did not contain a request number");
  return match[1];
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (/Failed to load resource:.*status of (403|404)/.test(text)) return;
      browserErrors.push(text);
    });
    await provide(page);
    expect(browserErrors, "Unhandled browser errors").toEqual([]);
  },
});
export { expect };
