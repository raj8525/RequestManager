import { expect, loginAs, test } from "./fixtures";

type Viewport = { width: number; height: number };

async function assertViewportIntegrity(
  page: import("@playwright/test").Page,
  viewport: Viewport,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(50);
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        tagName: element.tagName,
      })),
  }));
  expect(
    metrics.scrollWidth,
    `Elements overflowing the viewport: ${JSON.stringify(metrics.overflowing)}`,
  ).toBe(metrics.clientWidth);

  const main = page.locator("main");
  const firstBox = await main.boundingBox();
  await page.waitForTimeout(200);
  const secondBox = await main.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs((firstBox?.height ?? 0) - (secondBox?.height ?? 0))).toBeLessThan(2);
}

test("keeps customer workflows usable at the approved viewport sizes", async ({
  page,
}, testInfo) => {
  const viewports =
    testInfo.project.name === "mobile-chrome"
      ? [
          { width: 390, height: 844 },
          { width: 360, height: 800 },
        ]
      : [
          { width: 1440, height: 900 },
          { width: 1024, height: 768 },
        ];

  await loginAs(page, "customerA");
  for (const viewport of viewports) {
    await page.goto("/requests");
    await assertViewportIntegrity(page, viewport);
    if (viewport.width < 768) {
      await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
    } else {
      await expect(page.locator(".app-sidebar")).toBeVisible();
    }

    await page.goto("/requests/new");
    await assertViewportIntegrity(page, viewport);
    await expect(page.getByRole("button", { name: "提交需求" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`customer-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
});

test("keeps developer tables and dialogs within the viewport", async ({ page }, testInfo) => {
  const viewports =
    testInfo.project.name === "mobile-chrome"
      ? [
          { width: 390, height: 844 },
          { width: 360, height: 800 },
        ]
      : [
          { width: 1440, height: 900 },
          { width: 1024, height: 768 },
        ];

  await loginAs(page, "developerA");
  for (const viewport of viewports) {
    await page.goto("/manage/users");
    await assertViewportIntegrity(page, viewport);
    await page.getByRole("button", { name: "新建账号" }).click();
    const dialog = page.getByRole("dialog", { name: "新建账号" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0).toBe(true);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.goto("/manage/projects");
    await assertViewportIntegrity(page, viewport);
    await page.screenshot({
      path: testInfo.outputPath(`developer-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
});
