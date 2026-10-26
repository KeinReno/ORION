// Browser mouse/pointer and simulated clock evidence; physical Android touch acceptance is separate.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out = "test-results/android-gestures"; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: "dark" });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  await page.clock.install({ time: new Date(2026, 9, 21, 23, 50) });
  await page.goto("http://127.0.0.1:3180");
  await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  // Moving before the hold threshold must not open the menu.
  await page.mouse.move(16, 580); await page.mouse.down(); await page.mouse.move(16, 620); await page.waitForTimeout(450); await page.mouse.up();
  assert.equal(await page.getByRole("dialog", { name: "Быстрые действия" }).count(), 0);
  const touch = await context.newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 16, y: 580 }] });
  await page.waitForTimeout(480);
  const menu = page.getByRole("dialog", { name: "Быстрые действия" }); await menu.waitFor();
  await page.screenshot({ path: out + "/hold-menu.png", fullPage: true });
  const note = await menu.getByRole("button", { name: "Заметка", exact: true }).boundingBox();
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: note.x + note.width / 2, y: note.y + note.height / 2 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.getByRole("heading", { name: "Заметка", exact: true }).waitFor();
  await page.getByLabel("Название", { exact: true }).fill("Черновик удержания");
  await page.getByRole("button", { name: "Назад к списку, оставить черновик" }).click();
  await page.getByRole("button", { name: "Быстрые действия", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Задача", exact: true }).click();
  assert.equal(await page.getByLabel("Название", { exact: true }).inputValue(), "Черновик удержания");
  await page.getByRole("button", { name: "Отменить изменения", exact: true }).click();
  for (const title of ["Альфа", "Бета", "Гамма"]) {
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByLabel("Название", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("button", { name: "Переместить задачу: " + title, exact: true }).waitFor();
  }
  await page.setViewportSize({ width: 412, height: 1400 });
  const names = async () => page.locator(".task-row .entry-main strong").allTextContents();
  const before = await names();
  const handle = page.getByRole("button", { name: "Переместить задачу: " + before[0], exact: true });
  const grip = await handle.boundingBox(); const target = await page.locator("li[data-task-id]").last().boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 + 10, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction((title) => [...document.querySelectorAll(".task-row .entry-main strong")].at(-1)?.textContent === title, before[0]);
  const ordered = await names(); await page.reload(); await page.getByRole("button", { name: "Переместить задачу: " + ordered[0], exact: true }).waitFor(); assert.deepEqual(await names(), ordered);
  await page.getByRole("button", { name: "Переместить задачу: " + ordered[0], exact: true }).click();
  await page.getByRole("button", { name: "Ниже", exact: true }).click();
  await page.waitForFunction((title) => document.querySelector(".task-row .entry-main strong")?.textContent !== title, ordered[0]);
  // Quick income opens a fresh finance form.
  await page.getByRole("button", { name: "Быстрые действия", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Доход", exact: true }).click();
  await page.getByRole("button", { name: "Записать доход", exact: true }).waitFor();
  // Clock advance proves automatic today and explicit custom date behavior.
  await page.clock.setSystemTime(new Date(2026, 9, 21, 23, 59, 55));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator(".finance-details summary").click();
  assert.equal(await page.getByLabel("Дата", { exact: true }).inputValue(), "2026-10-21");
  await page.clock.fastForward(20000);
  assert.equal(await page.getByLabel("Дата", { exact: true }).inputValue(), "2026-10-22");
  await page.getByLabel("Дата", { exact: true }).fill("2026-10-10");
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  assert.equal(await page.getByLabel("Дата", { exact: true }).inputValue(), "2026-10-10");
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  assert.equal(await page.getByLabel("Дата", { exact: true }).inputValue(), "2026-10-23");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Быстрые действия", exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: out + "/menu-320.png", fullPage: true });
  await page.keyboard.press("Escape"); assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: hold/slide/release, scroll threshold, accessible menu, draft preservation, pointer task reorder/restart/buttons, quick income, midnight/custom/Today, 320px; browser-only.");
} finally { await browser.close(); }
