// Browser fixtures only: does not prove Android IME/TalkBack/SQLite behavior.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out = process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha28/preview";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: "dark" });
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:3180");
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("План на выходные");
  const body = page.getByLabel("Текст заметки", { exact: true });
  await body.fill("Прогулка и кофе");
  await body.evaluate((node) => { node.focus(); node.setSelectionRange(0, 8); });
  await page.getByRole("button", { name: "Жирный текст", exact: true }).click();
  assert.equal(await body.inputValue(), "**Прогулка** и кофе");
  assert.deepEqual(await body.evaluate((node) => [node.selectionStart, node.selectionEnd]), [2, 10]);
  await page.getByRole("button", { name: "Жирный текст", exact: true }).click();
  assert.equal(await body.inputValue(), "Прогулка и кофе");
  await body.evaluate((node) => node.setSelectionRange(0, node.value.length));
  await page.getByRole("button", { name: "Список", exact: true }).click();
  assert.equal(await body.inputValue(), "- Прогулка и кофе");
  await page.locator(".markdown-preview summary").click();
  await page.locator(".markdown-body li").filter({ hasText: "Прогулка и кофе" }).waitFor();
  await page.getByText("Черновик сохранён на телефоне", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Назад к списку, оставить черновик", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /Продолжить черновик/ }).click();
  assert.equal(await body.inputValue(), "- Прогулка и кофе");
  const original = "я".repeat(20000);
  await body.fill(original); await body.evaluate((node) => { node.focus(); node.setSelectionRange(0, node.value.length); });
  await page.getByRole("button", { name: "Жирный текст", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Для форматирования не хватает места" });
  await alert.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert");
  const alertBox = await alert.boundingBox();
  assert.ok(alertBox.y >= 0 && alertBox.y + alertBox.height <= 915, "Error should be visible without scrolling manually");
  assert.equal(await body.inputValue(), original, "No partial formatting or truncated user text at the limit");
  // Removing existing markers at the limit must still work.
  await body.fill("**" + "я".repeat(19996) + "**");
  await body.evaluate((node) => { node.focus(); node.setSelectionRange(2, 19998); });
  await page.getByRole("button", { name: "Жирный текст", exact: true }).click();
  assert.equal((await body.inputValue()).length, 19996);
  await body.fill("## План\n\nПрогулка и кофе");
  await page.getByLabel("Теги через запятую", { exact: true }).fill("я".repeat(41));
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Не больше 20 тегов" }).waitFor();
  assert.equal(await body.inputValue(), "## План\n\nПрогулка и кофе");
  await page.getByLabel("Теги через запятую", { exact: true }).fill("выходные");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.locator(".notes .entry-main").filter({ hasText: "План на выходные" }).click();
  assert.equal(await body.inputValue(), "## План\n\nПрогулка и кофе");
  await page.waitForFunction(() => !document.querySelector(".editor-bar .primary")?.disabled);
  for (const [width, font, scheme] of [[412, "100%", "dark"], [320, "200%", "light"], [900, "200%", "dark"]]) {
    await page.setViewportSize({ width, height: 740 }); await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, font);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `editor ${width}/${font}`);
    for (const control of await page.getByRole("group", { name: "Форматирование заметки" }).getByRole("button").all()) {
      const rect = await control.boundingBox(); assert.ok(rect.width >= 48 && rect.height >= 48);
    }
    assert.equal(await page.getByRole("heading", { name: "Заметка", exact: true }).evaluate((node) => node.getBoundingClientRect().height < 90), true, "Editor title must not wrap one syllable per line");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${out}/note-editor-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: note format/toggle/selection/list/preview, draft reload, length guard without truncation, unformat at limit, visible error, validation retry and save/reopen, 48px targets and 320/412/900px; browser only.");
} finally { await browser.close(); }
