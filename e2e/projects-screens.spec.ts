import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Screens of the Projects module on realistic synthetic data. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/projects";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

for (const pluginsOff of [false]) {
  test(`projects screens: board, overview, narrow, empty (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const account = await register(request, "projects-screens");
    const seeded = await seedProjects(request, account);
    await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Проекты", exact: true }).click();
    await expect(page.getByText("Поездка в Карелию").first()).toBeVisible();
    await shot(page, "board-list-1600");
    await page.getByRole("tab", { name: "Карточки", exact: true }).click();
    await shot(page, "board-cards-1600");
    await page.getByRole("tab", { name: "Список", exact: true }).click();

    await page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^Задачи/ }).first()).toBeVisible();
    await shot(page, "overview-1600");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "overview-390");
    await page.setViewportSize({ width: 1600, height: 900 });

    // Narrow board, both layouts.
    await page.getByRole("button", { name: "Проекты", exact: true }).first().click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: "Проекты", exact: true }).click();
    await expect(page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true })).toBeVisible();
    await shot(page, "board-list-390");
    const disclosure = page.locator("summary").filter({ hasText: "Вид и порядок" });
    if (await disclosure.count()) await disclosure.click();
    await page.getByRole("tab", { name: "Карточки", exact: true }).click();
    await shot(page, "board-cards-390");
    await page.getByRole("tab", { name: "Список", exact: true }).click();

    // Error state: the list request fails, then a retry succeeds.
    await page.setViewportSize({ width: 1600, height: 900 });
    let fail = true;
    await page.route(/\/projects(\?.*)?$/, async route => {
      if (fail && route.request().method() === "GET") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Сервис недоступен" }) });
      else await route.continue();
    });
    await page.reload();
    await page.getByRole("button", { name: "Проекты", exact: true }).click();
    await expect(page.getByText("Не удалось загрузить проекты").first()).toBeVisible();
    await shot(page, "board-error-1600");
    fail = false;
    await page.getByRole("button", { name: "Повторить", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true })).toBeVisible();
  });

  test("projects screens: empty workspace", async ({ page, request }) => {
    const account = await register(request, "projects-empty");
    await signIn(page, account);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Проекты", exact: true }).click();
    await expect(page.getByText("Проектов пока нет")).toBeVisible();
    await shot(page, "board-empty-1600");
  });
}
