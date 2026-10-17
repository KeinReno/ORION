import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

for (const width of [1280, 390]) {
  test(`light preview, portal cancel and draft preservation at ${width}px never write preferences`, async ({ page, request }, testInfo) => {
    const account = await register(request, `theme-preview-${width}`);
    await signIn(page, account);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/panel/settings?workspaceId=${account.workspaceId}`);
    if (width < 640) await page.getByRole("combobox", { name: "Раздел настроек", exact: true }).selectOption("appearance");
    else await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Предпросмотр тем" }).click();
    const region = page.getByRole("region", { name: "Предпросмотр тем", exact: true });
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const before = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
    const writes: string[] = [];
    page.on("request", req => { if (req.url().endsWith("/settings/preferences") && ["PATCH", "POST", "PUT", "DELETE"].includes(req.method())) writes.push(req.method()); });
    const accentBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--orion-accent"));
    await region.getByRole("combobox", { name: "Палитра образца", exact: true }).selectOption("arctic");
    await region.getByRole("button", { name: "Включить предпросмотр", exact: true }).click();
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
  await page.goto(`/panel/settings?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Предпросмотр тем" }).click();
  const region = page.getByRole("region", { name: "Предпросмотр тем", exact: true });
  await region.getByRole("button", { name: "Создать копию", exact: true }).click();
  await region.getByLabel("Акцент", { exact: true }).evaluate((node: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(node, "#147866");
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const pendingDownload = page.waitForEvent("download");
  await region.getByRole("button", { name: "Экспортировать тему", exact: true }).click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing exported theme");
  let json = ""; for await (const chunk of stream) json += chunk.toString();
  const exported = JSON.parse(json);
  expect(exported.schemaVersion).toBe(1);
  expect(exported.colors.accent).toBe("#147866");
  expect(exported.colors.focus).toBe(exported.colors.accentHover);
  await region.getByRole("combobox", { name: "Палитра образца", exact: true }).selectOption("arctic");
  await expect(region.getByRole("button", { name: "Заменить копию", exact: true })).toBeVisible();
  await region.getByRole("combobox", { name: "Палитра образца", exact: true }).selectOption("custom");
  await expect(region.getByLabel("Акцент", { exact: true })).toHaveValue("#147866");
  const file = region.getByLabel("Импортировать файл темы (.json)", { exact: true });
  await file.setInputFiles({ name: "unsafe.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...exported, colors: { accent: "url(https://example.test)" } })) });
  await expect(region.getByRole("alert")).toContainText("Предыдущая палитра сохранена");
  await expect(region.getByLabel("Акцент", { exact: true })).toHaveValue("#147866");
  await file.setInputFiles({ name: "good.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, id: "my-import", name: "Мой образец", baseMode: "light", colors: { accent: "#136b60" } })) });
  await expect(region.getByRole("alert")).toHaveCount(0);
  await expect(region.getByRole("combobox", { name: "Палитра образца", exact: true })).toHaveValue("custom");
  await region.getByRole("button", { name: "Включить предпросмотр", exact: true }).click();
  await expect(region.locator('[data-kaiden-theme="my-import"]').first()).toHaveCSS("color-scheme", "light");
  await region.getByRole("button", { name: "Сбросить образец", exact: true }).click();
  await expect(region.getByRole("combobox", { name: "Палитра образца", exact: true })).toHaveValue("precision");
  await expect(region.getByRole("button", { name: "Включить предпросмотр", exact: true })).toBeVisible();
});


const PRESET_TEXT: Record<string, string> = {
  obsidian: "rgb(236, 236, 238)", midnight: "rgb(234, 240, 250)", emerald: "rgb(238, 243, 240)", crimson: "rgb(244, 238, 239)"
};
test("every built-in preset previews its own palette without writing preferences", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "theme-presets");
  await signIn(page, account);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/panel/settings?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Предпросмотр тем" }).click();
  const region = page.getByRole("region", { name: "Предпросмотр тем", exact: true });
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const before = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
  const writes: string[] = [];
  page.on("request", req => { if (req.url().endsWith("/settings/preferences") && ["PATCH", "POST", "PUT", "DELETE"].includes(req.method())) writes.push(req.method()); });
  const select = region.getByRole("combobox", { name: "Палитра образца", exact: true });
  await expect(select.locator("option")).toHaveText(["KAIDEN Precision", "Obsidian", "Midnight", "Emerald", "Crimson", "Arctic (светлая)"]);
  await region.getByRole("button", { name: "Включить предпросмотр", exact: true }).click();
  for (const [id, text] of Object.entries(PRESET_TEXT)) {
    await select.selectOption(id);
    const sample = region.locator(`[data-kaiden-theme="${id}"]`).first();
    await expect(sample.getByLabel("Название образца", { exact: true })).toHaveCSS("color", text);
    await page.screenshot({ path: `tmp/redesign/theme-preset-${id}.png` });
  }
  expect(writes).toEqual([]);
  expect(await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json()).toEqual(before);
});
