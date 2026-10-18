import { expect, test, type Page } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

/** Every settings write a theme preview could make: preferences, the library and the workspace palette. */
function recordThemeWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", req => {
    const url = req.url();
    if ((url.includes("/settings/") || url.endsWith("/theme")) && ["PATCH", "POST", "PUT", "DELETE"].includes(req.method())) writes.push(`${req.method()} ${url}`);
  });
  return writes;
}

async function openAppearance(page: Page, workspaceId: string, width: number): Promise<void> {
  await page.goto(`/panel/settings?workspaceId=${workspaceId}`);
  if (width < 640) await page.getByRole("combobox", { name: "Раздел настроек", exact: true }).selectOption("appearance");
  else await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
}

for (const width of [1280, 390]) {
  test(`light preview, portal cancel and draft preservation at ${width}px never write preferences`, async ({ page, request }, testInfo) => {
    const account = await register(request, `theme-preview-${width}`);
    await signIn(page, account);
    await page.setViewportSize({ width, height: 800 });
    await openAppearance(page, account.workspaceId, width);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const before = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
    const writes = recordThemeWrites(page);
    const accentBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--orion-accent"));
    await page.getByRole("region", { name: "Библиотека тем", exact: true }).getByRole("button", { name: "Открыть тему «Arctic» в редакторе", exact: true }).click();
    const region = page.getByRole("region", { name: "Редактор темы", exact: true });
    await expect(region.getByRole("button", { name: "Отменить предпросмотр", exact: true })).toBeVisible();
    const sample = region.locator('[data-kaiden-theme="arctic"]').first();
    const name = sample.getByLabel("Название образца", { exact: true });
    await expect(name).toHaveCSS("color", "rgb(23, 33, 43)");
    await name.fill("Сохранённый ввод образца");
    await expect(name).toHaveCSS("border-color", "rgba(48, 92, 140, 0.7)");
    await sample.getByRole("button", { name: "Показать уведомление", exact: true }).click();
    const toast = page.locator(".pointer-events-auto").filter({ hasText: "Проверочное уведомление" });
    await expect(toast).toHaveAttribute("data-kaiden-theme", "arctic");
    await expect(toast).toHaveCSS("background-color", "rgba(255, 255, 255, 0.9)");
    await sample.getByRole("button", { name: "Подсказка", exact: true }).focus();
    await expect(page.getByRole("tooltip")).toHaveCSS("color", "rgb(23, 33, 43)");
    await sample.getByRole("button", { name: "Открыть диалог", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Диалог образца", exact: true });
    await expect(dialog).toHaveCSS("background-color", "rgba(255, 255, 255, 0.85)");
    await dialog.getByLabel("Черновик образца", { exact: true }).fill("Не терять при отмене темы");
    await testInfo.attach(`arctic-dialog-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    await dialog.getByRole("button", { name: "Отменить предпросмотр", exact: true }).click();
    await expect(dialog.getByLabel("Черновик образца", { exact: true })).toHaveValue("Не терять при отмене темы");
    await expect(dialog).toHaveCSS("background-color", "rgba(20, 20, 25, 0.85)");
    await expect(dialog).toHaveCSS("color-scheme", "dark");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(region.getByLabel("Название образца", { exact: true })).toHaveValue("Сохранённый ввод образца");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--orion-accent"))).toBe(accentBefore);
    expect(writes).toEqual([]);
    expect(await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json()).toEqual(before);
  });
}

test("copy editing, JSON export/import and invalid import work with plugins disabled", async ({ page, request }) => {
  const account = await register(request, "theme-files");
  await disableAllPlugins(request, account);
  await signIn(page, account);
  await openAppearance(page, account.workspaceId, 1280);
  const writes = recordThemeWrites(page);
  await page.getByRole("region", { name: "Библиотека тем", exact: true }).getByRole("button", { name: "Открыть тему «KAIDEN Precision» в редакторе", exact: true }).click();
  const region = page.getByRole("region", { name: "Редактор темы", exact: true });
  await expect(region).toContainText("Встроенная тема");
  await expect(region.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await region.getByLabel("Акцент", { exact: true }).evaluate((node: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(node, "#147866");
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // The first edit of a built-in palette turns it into a new copy; the preset itself never changes.
  await expect(region).toContainText("Новая тема");
  await expect(region.getByLabel("Название темы", { exact: true })).toHaveValue("KAIDEN Precision — копия");
  const pendingDownload = page.waitForEvent("download");
  await region.getByRole("button", { name: "Экспортировать тему", exact: true }).click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing exported theme");
  let json = ""; for await (const chunk of stream) json += chunk.toString();
  const exported = JSON.parse(json);
  expect(exported.schemaVersion).toBe(1);
  expect(exported.id).toMatch(/^custom-/);
  expect(exported.colors.accent).toBe("#147866");
  expect(exported.colors.focus).toBe(exported.colors.accentHover);
  const file = region.getByLabel("Импортировать файл темы (.json)", { exact: true });
  await file.setInputFiles({ name: "unsafe.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...exported, colors: { accent: "url(https://example.test)" } })) });
  await expect(region.getByRole("alert")).toContainText("Применённая тема не изменилась");
  await expect(region.getByLabel("Акцент", { exact: true })).toHaveValue("#147866");
  await file.setInputFiles({ name: "good.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, id: "my-import", name: "Мой образец", baseMode: "light", colors: { accent: "#136b60" } })) });
  await expect(region.getByRole("alert")).toHaveCount(0);
  await expect(region.getByLabel("Название темы", { exact: true })).toHaveValue("Мой образец");
  await expect(region.getByRole("button", { name: "Отменить предпросмотр", exact: true })).toBeVisible();
  await expect(region.locator('[data-kaiden-theme="my-import"]').first()).toHaveCSS("color-scheme", "light");
  // Closing over unsaved edits asks first.
  await region.getByRole("button", { name: "Закрыть редактор", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Отбросить изменения темы?", exact: true });
  await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(region).toBeVisible();
  await region.getByRole("button", { name: "Закрыть редактор", exact: true }).click();
  await confirm.getByRole("button", { name: "Отбросить", exact: true }).click();
  await expect(region).toHaveCount(0);
  expect(writes).toEqual([]);
});

const PRESET_TEXT: Record<string, string> = {
  Obsidian: "rgb(236, 236, 238)", Midnight: "rgb(234, 240, 250)", Emerald: "rgb(238, 243, 240)", Crimson: "rgb(244, 238, 239)"
};
const PRESET_IDS: Record<string, string> = { Obsidian: "obsidian", Midnight: "midnight", Emerald: "emerald", Crimson: "crimson" };
test("every built-in preset previews its own palette without writing preferences", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "theme-presets");
  await signIn(page, account);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAppearance(page, account.workspaceId, 1280);
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const before = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
  const writes = recordThemeWrites(page);
  const library = page.getByRole("region", { name: "Библиотека тем", exact: true });
  await expect(library.locator("li p.truncate")).toHaveText(["KAIDEN Precision", "Obsidian", "Midnight", "Emerald", "Crimson", "Arctic"]);
  for (const [name, text] of Object.entries(PRESET_TEXT)) {
    await library.getByRole("button", { name: `Открыть тему «${name}» в редакторе`, exact: true }).click();
    const sample = page.getByRole("region", { name: "Редактор темы", exact: true }).locator(`[data-kaiden-theme="${PRESET_IDS[name]}"]`).first();
    await expect(sample.getByLabel("Название образца", { exact: true })).toHaveCSS("color", text);
    await page.screenshot({ path: `tmp/redesign/theme-preset-${PRESET_IDS[name]}.png` });
  }
  expect(writes).toEqual([]);
  expect(await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json()).toEqual(before);
});
