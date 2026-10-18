import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Note editor on realistic data at desktop and phone widths. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/note-editor";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

const LONG_TITLE = "Протокол встречи с подрядчиком по замене окон в спальне и детской, включая подоконники, откосы и вывоз старых рам";

async function fits(box: Locator): Promise<boolean> {
  return box.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
}

for (const pluginsOff of [false, true]) {
  test(`note editor: create, edit, reload; long title at 1440, 390 and 320 (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const account = await register(request, "note-editor");
    if (pluginsOff) await disableAllPlugins(request, account);
    const seeded = await seedProjects(request, account);
    await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Заметки", exact: true }).click();

    // Create explicitly.
    await page.getByRole("button", { name: "Новая", exact: true }).click();
    const editor = page.getByRole("form", { name: "Редактор заметки", exact: true });
    await editor.getByRole("textbox", { name: "Название заметки", exact: true }).fill(LONG_TITLE);
    await editor.getByRole("textbox", { name: "Краткое описание", exact: true }).fill("Сроки, смета и предоплата");
    await editor.locator(".cm-content").click();
    await page.keyboard.type("# Итоги\n\nТри окна: спальня, детская и балконный блок. Подрядчик просит предоплату 30%.\n");
    await editor.getByRole("button", { name: "Создать", exact: true }).first().click();
    await expect(editor).toContainText("Всё сохранено");

    // Edit with autosave: body and a tag.
    await editor.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nМонтаж после 20 октября.");
    const tagInput = editor.getByPlaceholder(/^(Новый тег|Ещё тег)$/);
    await tagInput.fill("ремонт");
    await tagInput.press("Enter");
    await expect(editor).toContainText("Всё сохранено", { timeout: 10_000 });
    await shot(page, pluginsOff ? "editor-1440-plugins-off" : "editor-1440");
    await editor.getByRole("tab", { name: "Просмотр", exact: true }).click();
    await expect(editor.getByRole("heading", { name: "Итоги" })).toBeVisible();
    if (!pluginsOff) await shot(page, "preview-1440");
    await editor.getByRole("tab", { name: "Правка", exact: true }).click();

    // Reload: everything came from the server.
    await page.reload();
    await page.getByRole("button", { name: "Заметки", exact: true }).click();
    const reopened = page.getByRole("form", { name: "Редактор заметки", exact: true });
    if ((await reopened.count()) === 0) await page.getByText(LONG_TITLE).first().click();
    const title = reopened.getByRole("textbox", { name: "Название заметки", exact: true });
    await expect(title).toHaveValue(LONG_TITLE);
    await expect(reopened.locator(".cm-content")).toContainText("Монтаж после 20 октября.");
    await expect(reopened).toContainText("ремонт");
    expect.soft(await fits(title), "title fits its box").toBe(true);

    // Phone widths: nothing sticks out, the title reads in full.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(reopened).toBeVisible();
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}`).toBe(true);
      expect.soft(await reopened.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `no editor overflow at ${width}`).toBe(true);
      expect.soft(await fits(title), `title fits at ${width}`).toBe(true);
      if (!pluginsOff) await shot(page, `editor-${width}`);
    }
  });
}
