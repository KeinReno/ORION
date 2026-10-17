import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Task detail on realistic data at desktop and phone widths. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/task-detail";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

const LONG_TITLE = "Согласовать с подрядчиком смету на замену окон в спальне и детской, включая подоконники, откосы и вывоз старых рам до начала отопительного сезона";

for (const pluginsOff of [false, true]) {
  test(`task detail: create, edit every field, reload; long text at 1440, 390 and 320 (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const account = await register(request, "task-detail");
    if (pluginsOff) await disableAllPlugins(request, account);
    const seeded = await seedProjects(request, account);
    await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: /^Задачи/ }).first().click();

    // Create from the list.
    await page.getByRole("button", { name: "Новая задача", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Новая задача", exact: true });
    await dialog.getByPlaceholder("Заголовок").fill(LONG_TITLE);
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Open it and change the fields the detail owns.
    await page.getByText(LONG_TITLE, { exact: true }).first().click();
    const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
    await expect(detail.getByRole("textbox", { name: "Название задачи", exact: true })).toHaveValue(LONG_TITLE);
    await detail.getByRole("combobox", { name: "Статус", exact: true }).selectOption("in_progress");
    await detail.getByRole("combobox", { name: /^Приоритет/ }).selectOption("high");
    await detail.getByRole("combobox", { name: /^Проект/ }).selectOption({ label: "Ремонт кухни" });
    await detail.getByRole("textbox", { name: "Описание", exact: true }).fill("Три окна: спальня 140×150, детская 120×150 и балконный блок.\n\nПодрядчик просит предоплату 30%.");
    await expect(detail).toContainText("Всё сохранено");
    await shot(page, pluginsOff ? "detail-1440-plugins-off" : "detail-1440");

    // Reload: everything came from the server.
    await page.reload();
    await page.getByRole("button", { name: /^Задачи/ }).first().click();
    const opened = page.getByRole("region", { name: "Детали задачи", exact: true });
    if ((await opened.count()) === 0) await page.getByText(LONG_TITLE, { exact: true }).first().click();
    await expect(opened.getByRole("textbox", { name: "Название задачи", exact: true })).toHaveValue(LONG_TITLE);
    await expect(opened.getByRole("combobox", { name: "Статус", exact: true })).toHaveValue("in_progress");
    await expect(opened.getByRole("combobox", { name: /^Приоритет/ })).toHaveValue("high");
    await expect(opened.getByRole("combobox", { name: /^Проект/ })).toHaveValue(seeded.home.id);
    await expect(opened.getByRole("textbox", { name: "Описание", exact: true })).toHaveValue(/предоплату 30%/);

    // The whole title is readable, not cut at the pane edge.
    const titleBox = opened.getByRole("textbox", { name: "Название задачи", exact: true });
    expect.soft(await titleBox.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), "title fits its box").toBe(true);

    // Phone widths: the pane replaces the list; nothing sticks out, the status reads in full.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(opened).toBeVisible();
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}`).toBe(true);
      expect.soft(await opened.evaluate((node) => node.scrollWidth <= node.clientWidth), `no pane overflow at ${width}`).toBe(true);
      const status = opened.getByRole("combobox", { name: "Статус", exact: true });
      expect.soft(await status.evaluate((node: HTMLSelectElement) => {
        const probe = document.createElement("span");
        probe.style.font = getComputedStyle(node).font;
        probe.textContent = node.selectedOptions[0]?.text ?? "";
        document.body.append(probe);
        const fits = probe.getBoundingClientRect().width + 40 <= node.clientWidth;
        probe.remove();
        return fits;
      }), `status label fits at ${width}`).toBe(true);
      if (!pluginsOff) await shot(page, `detail-${width}`);
    }
  });
}
