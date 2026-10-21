// Browser-only evidence for mobile settings; native APK installation is separate.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const output = process.env.ANDROID_SMOKE_OUTPUT || "test-results/android-alpha2";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: "dark" });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let requests = 0;
  let mode = "new";
  await page.route("https://raw.githubusercontent.com/KeinReno/ORION-Android-Releases/main/android-update.json", async (route) => {
    requests++;
    if (mode === "offline") { await route.abort("failed"); return; }
    const code = mode === "new" ? 9 : 8;
    const version = mode === "new" ? "0.1.8" : "0.1.7";
    const tag = mode === "new" ? "v0.1.8-android-alpha.9" : "v0.1.7-android-alpha.8";
    await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({
      schemaVersion: 1, applicationId: "io.kaiden.orion.android",
      versionCode: code, versionName: version, tag,
      publishedAt: "2026-10-21T08:00:00.000Z", notes: "Тестовый будущий релиз. Проверка описания обновлений.",
      apk: {
        url: "https://github.com/KeinReno/ORION-Android-Releases/releases/download/" + tag + "/KAIDEN-Orion-" + tag.slice(1) + ".apk",
        sha256: "a".repeat(64), size: 5000000,
      },
    }) });
  });
  await page.goto("http://127.0.0.1:3180");
  await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  await page.getByRole("button", { name: /Настройки/ }).click();
  await page.getByText("Доступна версия 0.1.8", { exact: true }).waitFor();
  assert.equal(requests, 1);
  await page.getByText("Что изменилось", { exact: true }).click();
  await page.getByText("Тестовый будущий релиз. Проверка описания обновлений.", { exact: true }).waitFor();
  await page.screenshot({ path: output + "/settings-update-dark.png", fullPage: true });
  await page.locator(".segments label").filter({ hasText: "Светлая" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.getByRole("switch", { name: /Проверять автоматически/ }).click();
  await page.waitForFunction(() => !document.querySelectorAll('input[role="switch"]')[0].checked);
  await page.getByRole("switch", { name: /Загружать по Wi-Fi/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('input[role="switch"]')[1].checked);
  await page.reload();
  await page.getByRole("button", { name: /Настройки/ }).click();
  await page.getByRole("heading", { name: "Обновления", exact: true }).waitFor();
  assert.equal(await page.getByRole("switch", { name: /Проверять автоматически/ }).isChecked(), false);
  assert.equal(await page.getByRole("switch", { name: /Загружать по Wi-Fi/ }).isChecked(), true);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.equal(requests, 1);
  mode = "current";
  await page.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  await page.getByText("Установлена актуальная версия.", { exact: true }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Скачать обновление", exact: true }).count(), 0);
  mode = "offline";
  await page.getByRole("button", { name: "Проверить обновления", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Не удалось проверить обновления" }).waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: output + "/settings-offline-light-320-font130.png", fullPage: true });
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: Android-only update manifest, automatic check, changelog, theme and switches persist, auto-check disabled after restart, current-version state, offline recovery, 320px/font130; browser-only.");
  await context.close();
} catch (error) {
  if (page) {
    console.error(await page.locator("body").innerText());
    await page.screenshot({ path: output + "/failure.png", fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
