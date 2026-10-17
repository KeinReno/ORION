import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Screens of the Tasks module on synthetic data. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/tasks";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

test("tasks screens: list, detail, narrow, empty", async ({ page, request }) => {
  test.setTimeout(150_000);
  const account = await register(request, "tasks-screens");
  const seeded = await seedProjects(request, account);
  await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: /^Задачи/ }).first().click();
  await expect(page.getByText("Забронировать домик у озера").first()).toBeVisible();
  await shot(page, "list-1600");
  await page.getByText("Забронировать домик у озера").first().click();
  await expect(page.getByRole("region", { name: "Детали задачи", exact: true })).toBeVisible();
  await shot(page, "detail-1600");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "detail-390");
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: /^Задачи/ }).click();
  // The open task is restored after the reload (stage 20) and replaces the list: go back to the list explicitly.
  const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
  await page.waitForTimeout(1500);
  if (await detail.isVisible()) await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Поиск задач", exact: true }).or(page.getByPlaceholder("Поиск задач"))).toBeVisible();
  await expect(page.getByText("Забронировать домик у озера").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page overflow at 390 px").toBe(true);
  const toolbar = page.getByRole("banner").or(page.locator("header")).locator("summary", { hasText: "Группировка и вид" });
  const box = await toolbar.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390, "the grouping disclosure fits the 390 px viewport").toBe(true);
  await shot(page, "list-390");
});

test("tasks screens: empty workspace", async ({ page, request }) => {
  const account = await register(request, "tasks-empty");
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: /^Задачи/ }).first().click();
  await page.waitForTimeout(800);
  await shot(page, "empty-1600");
});
