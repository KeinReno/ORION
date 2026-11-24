import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

/** Documents list on a realistic tree: many files, long names, nested and empty folders. `SHOT_DIR` selects evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/document-list";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

const LONG_NAME = "Акт приёмки выполненных работ по замене окон в спальне и детской с подписями обеих сторон.txt";

for (const pluginsOff of [false, true]) {
  test(`document list: navigate by keyboard, select, long names at 1440, 768, 390 and 320 (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const account = await register(request, "doc-list");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const base = `${apiUrl()}/workspaces/${account.workspaceId}/documents`;
    const make = async (name: string, parentId?: string) => (await request.post(base, { headers, data: { name, ...(parentId ? { parentId } : {}) } })).json();
    const upload = async (name: string, text: string, parentId?: string) => {
      const response = await request.post(`${base}/upload`, { headers, multipart: { ...(parentId ? { parentId } : {}), files: { name, mimeType: "text/plain", buffer: Buffer.from(text) } } });
      expect(response.ok(), await response.text()).toBe(true);
    };
    const repairs = await make("Ремонт квартиры — договоры, сметы, акты и гарантийные талоны");
    await make("Пустая папка", repairs.id);
    await make("Фотографии");
    await upload(LONG_NAME, "Работы выполнены в полном объёме.", repairs.id);
    await upload("Смета.txt", "Окна: 3 шт.", repairs.id);
    for (let i = 1; i <= 36; i += 1) await upload(`Чек ${String(i).padStart(2, "0")} — строительный магазин.txt`, `Покупка ${i}`);
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Документы", exact: true }).click();
    await expect(page.getByText("Чек 01 — строительный магазин.txt").first()).toBeVisible();
    await shot(page, pluginsOff ? "list-1440-plugins-off" : "list-1440");

    // Keyboard: open the folder, open a file, come back by the breadcrumb.
    const folder = page.getByRole("button", { name: /^Открыть папку Ремонт квартиры/ }).first();
    await folder.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(LONG_NAME).first()).toBeVisible();
    const file = page.getByRole("button", { name: /^Открыть Акт приёмки/ }).first();
    await file.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Работы выполнены в полном объёме.").first()).toBeVisible();
    if (!pluginsOff) await shot(page, "folder-preview-1440");
    await page.getByRole("button", { name: "Открыть папку Пустая папка", exact: true }).first().click();
    await expect(page.getByText("Здесь пока пусто").first()).toBeVisible();
    if (!pluginsOff) await shot(page, "empty-folder-1440");
    await page.getByRole("button", { name: "Все файлы", exact: true }).click();

    // Select two files: the bulk bar appears and can be dismissed.
    await page.getByRole("checkbox", { name: "Выбрать Чек 01 — строительный магазин.txt", exact: true }).check();
    await page.getByRole("checkbox", { name: "Выбрать Чек 02 — строительный магазин.txt", exact: true }).check();
    await expect(page.getByText("Выбрано: 2")).toBeVisible();
    expect.soft(await page.getByRole("group", { name: "Выбранные документы" }).evaluate((node) => node.getBoundingClientRect().height < 56), "bulk bar is one line").toBe(true);
    if (!pluginsOff) await shot(page, "selected-1440");
    await page.getByRole("group", { name: "Выбранные документы" }).getByRole("button", { name: "Снять", exact: true }).click();

    // Narrow widths: nothing sticks out, rows stay reachable.
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByText("Чек 01 — строительный магазин.txt").first()).toBeVisible();
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}`).toBe(true);
      if (!pluginsOff) await shot(page, `list-${width}`);
    }
  });
}
