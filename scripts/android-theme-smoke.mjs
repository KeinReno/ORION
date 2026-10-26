import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out = process.env.ANDROID_SMOKE_OUTPUT || "test-results/android-themes";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: "dark" });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:3180");
  const check = async (id, accent) => {
    await page.waitForFunction((expected) => document.documentElement.dataset.palette === expected, id);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kaiden-accent-base").trim()), accent);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  };
  await check("kaiden-precision", "201 168 106");
  await page.locator("main.content").evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  await page.screenshot({ path: out + "/tasks-precision.png", fullPage: true });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("link", { name: /Внешний вид/ }).click();
  for (const [id, rgb] of [["obsidian", "167 139 250"], ["midnight", "107 170 255"], ["emerald", "52 211 153"], ["crimson", "240 100 122"], ["kaiden-precision", "201 168 106"]]) {
    await page.getByLabel("Цвета тёмной темы").selectOption(id);
    await page.waitForFunction((expected) => document.documentElement.dataset.palette === expected, id);
    await check(id, rgb);
  }
  await page.getByLabel("Цвета тёмной темы").selectOption("midnight");
  await check("midnight", "107 170 255");
  await page.reload(); await check("midnight", "107 170 255");
  await page.emulateMedia({ colorScheme: "light" }); await check("arctic", "48 92 140");
  await page.getByRole("button", { name: "Финансы", exact: true }).click();
  await page.locator("main.content").evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  await page.screenshot({ path: out + "/finance-arctic.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  await page.locator("main.content").evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  await page.screenshot({ path: out + "/finance-arctic-320.png", fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ colorScheme: "dark" }); await check("midnight", "107 170 255");
  assert.deepEqual(errors, []);
  console.log("PASS: five desktop dark presets, exact token fixtures, persistence, system changes, Arctic, 320px/font130; browser-only.");
} finally { await browser.close(); }
