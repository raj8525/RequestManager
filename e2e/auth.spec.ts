import { accounts, E2E_PASSWORD, expect, loginAs, test } from "./fixtures";

test("redirects anonymous users and keeps login failures generic", async ({ page }) => {
  await page.goto("/requests");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("用户名").fill("does-not-exist");
  await page.getByLabel("密码").fill("incorrect password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.locator(".form-alert[role='alert']")).toHaveText(
    "用户名或密码错误",
  );
});

test("shows only role-appropriate navigation and logs out", async ({ page }) => {
  await loginAs(page, "customerA");
  await expect(page.getByRole("link", { name: "新建需求" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "账号管理" })).toHaveCount(0);

  await page.locator(".app-sidebar").getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await loginAs(page, "developerA");
  await expect(page.getByRole("link", { name: "账号管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "项目管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "新建需求" })).toHaveCount(0);
});

test("forces a newly created account to change its password while allowing logout", async ({
  page,
}) => {
  const username = "forced-change-user";
  const temporaryPassword = "temporary secure password";

  await loginAs(page, "developerA");
  await page.goto("/manage/users");
  await page.getByRole("button", { name: "新建账号" }).click();
  const dialog = page.getByRole("dialog", { name: "新建账号" });
  await dialog.getByLabel("用户名").fill(username);
  await dialog.getByLabel("显示名").fill("Forced Change User");
  await dialog.getByLabel("账号类型").selectOption("CUSTOMER");
  await dialog.locator("#user-new-password").fill(temporaryPassword);
  await dialog.locator("#user-new-password-confirmation").fill(temporaryPassword);
  await dialog.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByText(`@${username}`)).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(temporaryPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.goto("/requests");
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("用户名").fill(accounts.customerA);
  await page.getByLabel("密码").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/requests$/);
});
