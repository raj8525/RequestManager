import {
  createRequest,
  expect,
  fillHydrated,
  loginAs,
  test,
} from "./fixtures";

async function collectTextResponses(
  page: import("@playwright/test").Page,
  operation: () => Promise<void>,
): Promise<string> {
  const bodies: string[] = [];
  const listener = async (response: import("@playwright/test").Response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (!/(text|json|javascript|rsc)/i.test(contentType)) return;
    try {
      bodies.push(await response.text());
    } catch {
      // Navigation can dispose a response before its body is available.
    }
  };
  page.on("response", listener);
  await operation();
  await page.waitForLoadState("networkidle");
  page.off("response", listener);
  return bodies.join("\n");
}

test("keeps each developer private note out of other page and RSC payloads", async ({
  page,
}) => {
  const secretA = `DEVELOPER_A_PRIVATE_${Date.now()}`;
  const secretB = `DEVELOPER_B_PRIVATE_${Date.now()}`;

  await loginAs(page, "customerA");
  const requestNumber = await createRequest(page, {
    content: `私人笔记隔离验证需求 ${Date.now()}`,
  });

  await loginAs(page, "developerA");
  await page.goto(`/requests/${requestNumber}`);
  await fillHydrated(page.getByLabel("私人笔记内容"), secretA);
  await page.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("status")).toContainText("笔记已保存");

  await loginAs(page, "developerB");
  const developerBPayload = await collectTextResponses(page, async () => {
    await page.goto(`/requests/${requestNumber}`);
  });
  await expect(page.getByLabel("私人笔记内容")).toHaveValue("");
  await expect(page.getByText(secretA)).toHaveCount(0);
  expect(developerBPayload).not.toContain(secretA);
  await fillHydrated(page.getByLabel("私人笔记内容"), secretB);
  await page.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("status")).toContainText("笔记已保存");

  await loginAs(page, "developerA");
  const developerAPayload = await collectTextResponses(page, async () => {
    await page.goto(`/requests/${requestNumber}`);
  });
  await expect(page.getByLabel("私人笔记内容")).toHaveValue(secretA);
  expect(developerAPayload).not.toContain(secretB);

  await loginAs(page, "customerA");
  const customerPayload = await collectTextResponses(page, async () => {
    await page.goto(`/requests/${requestNumber}`);
  });
  await expect(page.getByRole("heading", { name: "私人笔记", exact: true })).toHaveCount(0);
  expect(customerPayload).not.toContain(secretA);
  expect(customerPayload).not.toContain(secretB);
});
