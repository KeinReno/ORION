// Isolated browser fixtures; not Android keyboard/SQLite/ColorOS acceptance.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out = process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha27/preview";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: "dark" });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:3180");
  for (const module of ["Задачи", "Заметки"]) {
    await page.getByRole("button", { name: module, exact: true }).click();
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByLabel("Название", { exact: true }).fill("План прогулки");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByLabel("Поиск", { exact: true }).fill("несуществующая запись");
    await page.getByRole("heading", { name: "Ничего не найдено", exact: true }).waitFor();
    const clear = page.getByRole("button", { name: "Очистить поиск", exact: true });
    const rect = await clear.boundingBox(); assert.ok(rect.width >= 48 && rect.height >= 48);
    await clear.click();
    assert.equal(await page.getByLabel("Поиск", { exact: true }).inputValue(), "");
    assert.equal(await page.getByLabel("Поиск", { exact: true }).evaluate((node) => node === document.activeElement), true);
    if (module === "Задачи") {
      await page.getByRole("group", { name: "Быстрые фильтры задач" }).getByRole("button", { name: "Сегодня", exact: true }).click();
    } else {
      await page.getByLabel("Фильтры заметок", { exact: true }).click();
      await page.getByLabel("Только закреплённые", { exact: true }).check();
    }
    await page.getByLabel("Поиск", { exact: true }).fill("нет совпадений");
    await page.getByRole("button", { name: module === "Задачи" ? "Показать все задачи" : "Показать все заметки", exact: true }).click();
    await page.getByText("План прогулки", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Поиск", { exact: true }).inputValue(), "");
  }
  await page.getByRole("button", { name: "Финансы", exact: true }).click();
  await page.getByLabel("Сумма, ₽").fill("450");
  await page.getByRole("button", { name: "Кафе", exact: true }).click();
  await page.getByRole("button", { name: "Записать расход", exact: true }).click();
  const entry = page.getByRole("button", { name: "Изменить операцию: Кафе", exact: true });
  await entry.waitFor();
  await page.getByLabel("Сумма, ₽").fill("123,45");
  await page.getByRole("button", { name: "К истории операций", exact: true }).click();
  await entry.click();
  await page.getByText(/В форме осталась незавершённая операция/).waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains("finance-history-warning"));
  const warning = await page.locator(".finance-history-warning").boundingBox();
  assert.ok(warning.y >= 0 && warning.y + warning.height <= 915, "Blocked edit warning must be brought into view");
  await page.getByRole("button", { name: "Перейти к черновику", exact: true }).click();
  assert.equal(await page.getByLabel("Сумма, ₽").inputValue(), "123,45");
  assert.equal(await page.getByLabel("Сумма, ₽").evaluate((node) => node === document.activeElement), true);
  await page.getByRole("button", { name: "Отменить ввод", exact: true }).click();
  await entry.click();
  assert.equal(await page.getByLabel("Сумма, ₽").inputValue(), "450,00");
  await page.getByRole("button", { name: "Отменить ввод", exact: true }).click();
  await page.getByLabel("Месяц операций", { exact: true }).fill("2020-01");
  await page.getByRole("button", { name: "Текущий месяц", exact: true }).click();
  await entry.waitFor();
  await page.screenshot({ path: out + "/finance-history-dark.png", fullPage: true });
  for (const [width, scheme] of [[320, "light"], [900, "dark"]]) {
    await page.setViewportSize({ width, height: 740 }); await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    for (const module of ["Задачи", "Заметки", "Финансы"]) {
      await page.getByRole("button", { name: module, exact: true }).click();
      if (module === "Финансы") await page.getByLabel("Месяц операций", { exact: true }).fill("2020-01");
      else await page.getByLabel("Поиск", { exact: true }).fill("длинная строка поиска без результата");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${module} at ${width}/200%`);
      if (width === 320) await page.screenshot({ path: `${out}/${module}-320-light.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: search cancel/focus/48px, combined empty recovery, finance draft preserved on edit collision, explicit draft/history navigation, current month, 320/900px at200%; browser only.");
} finally { await browser.close(); }
