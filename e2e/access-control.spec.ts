import { createRequest, expect, loginAs, test } from "./fixtures";

test("enforces project, management, request write and screenshot access on the server", async ({
  page,
}) => {
  await loginAs(page, "customerA");
  const requestNumber = await createRequest(page, {
    content: `跨项目访问控制验证需求 ${Date.now()}`,
    withScreenshot: true,
  });
  const imageUrl = await page
    .getByRole("list", { name: "需求截图" })
    .getByRole("img")
    .getAttribute("src");
  expect(imageUrl).toMatch(/^\/api\/attachments\/\d+$/);

  await loginAs(page, "customerB");
  await page.goto(`/requests/${requestNumber}`);
  await expect(page.getByRole("heading", { name: requestNumber })).toBeVisible();
  const sameProjectImage = await page.request.get(imageUrl!);
  expect(sameProjectImage.status()).toBe(200);

  await loginAs(page, "unassignedCustomer");
  await page.goto(`/requests/${requestNumber}`);
  await expect(page.getByRole("heading", { name: "没有找到这项内容" })).toBeVisible();
  const deniedImage = await page.request.get(imageUrl!);
  expect([403, 404]).toContain(deniedImage.status());
  await page.goto("/manage/users");
  await expect(page.getByRole("heading", { name: "没有找到这项内容" })).toBeVisible();
  await page.goto("/manage/projects");
  await expect(page.getByRole("heading", { name: "没有找到这项内容" })).toBeVisible();

  const tampered = new FormData();
  tampered.set("content", "越权修改不应成功，字段长度满足服务端要求");
  tampered.set("requestType", "NEW_FEATURE");
  tampered.set("priority", "URGENT");
  tampered.set("expectedVersion", "1");
  const tamperedResponse = await page.request.put(`/api/requests/${requestNumber}`, {
    multipart: {
      content: String(tampered.get("content")),
      requestType: String(tampered.get("requestType")),
      priority: String(tampered.get("priority")),
      expectedVersion: String(tampered.get("expectedVersion")),
    },
  });
  expect([403, 404]).toContain(tamperedResponse.status());

  await loginAs(page, "developerA");
  await page.goto(`/requests/${requestNumber}`);
  await expect(page.getByRole("heading", { name: requestNumber })).toBeVisible();
  const developerImage = await page.request.get(imageUrl!);
  expect(developerImage.status()).toBe(200);
  await page.goto("/requests/new");
  await expect(page.getByRole("heading", { name: "没有找到这项内容" })).toBeVisible();
});
