// Synthetic sensor/native preference bridge: hardware sensor acceptance remains separate.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.addInitScript(() => {
    window.androidBridge = {}; window.__callbacks = {}; window.__starts = 0; window.__stops = 0;
    const methods = { App: ["addListener", "removeListener"], OrionStorage: ["read", "write"], OrionLan: ["getState"], OrionUpdates: ["getState", "check", "addListener", "removeListener"], OrionMotion: ["getState"], OrionDepth: ["start", "stop", "addListener", "removeListener"] };
    window.Capacitor = {
      PluginHeaders: Object.entries(methods).map(([name, list]) => ({ name, methods: list.map((name) => ({ name, rtype: name === "addListener" ? "callback" : "promise" })) })),
      nativeCallback: (plugin, method, options, callback) => { (window.__callbacks[plugin + ":" + options.eventName] ??= []).push(callback); return Math.random().toString(); },
      nativePromise: async (plugin, method, options) => {
        if (plugin === "OrionStorage") { if (method === "read") return { value: localStorage.getItem("depth-snapshot") }; if (method === "write") { localStorage.setItem("depth-snapshot", options.value); return {}; } }
        if (plugin === "OrionLan") return { paired: false, node: null, user: null, address: "", port: 4443 };
        if (plugin === "OrionMotion") return { reduced: false };
        if (plugin === "OrionDepth") { if (method === "start") { window.__starts++; if (window.__depthError) throw new Error("sensor failure"); return { available: window.__depthAvailable !== false }; } if (method === "stop") window.__stops++; return {}; }
        if (plugin === "OrionUpdates") return { installedVersion: "0.1.9", installedCode: 10, lastChecked: Date.now(), lastAttempt: Date.now(), available: false, ready: false, manifest: null, wifi: false };
        return {};
      },
    };
  });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3180");
  await page.waitForFunction(() => document.documentElement.dataset.depth === "active");
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: .6, y: -.4 })));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--depth-x") === "5.04px");
  const button = page.getByRole("button", { name: "Создать", exact: true }); const before = await button.boundingBox();
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: -1, y: 1 })));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--depth-x") === "-8.40px");
  assert.deepEqual(await button.boundingBox(), before, "depth moved an interactive target");
  await page.mouse.move(170, 40); await page.mouse.down();
  await page.waitForFunction(() => document.documentElement.dataset.depth === "off"); await page.mouse.up();
  await page.waitForFunction(() => document.documentElement.dataset.depth === "active");
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForFunction(() => document.documentElement.dataset.depth === "off");
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--depth-x")), "0px");
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.waitForFunction(() => document.documentElement.dataset.depth === "active");
  await page.evaluate(() => window.__callbacks["App:appStateChange"].forEach((callback) => callback({ isActive: false })));
  await page.waitForFunction(() => document.documentElement.dataset.depth === "off");
  await page.evaluate(() => window.__callbacks["App:appStateChange"].forEach((callback) => callback({ isActive: true })));
  await page.waitForFunction(() => document.documentElement.dataset.depth === "active");
  await page.getByRole("button", { name: "Финансы", exact: true }).click(); await page.getByLabel("Сумма, ₽").focus();
  await page.waitForFunction(() => document.documentElement.dataset.depth === "off");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.depth === "active");
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: 1, y: 1 })));
  await page.getByRole("status").filter({ hasText: "Датчик работает" }).waitFor();
  const slider = page.getByLabel("Сила наклона");
  await slider.fill("100"); await slider.dispatchEvent("keyup", { key: "ArrowRight" });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("depth-snapshot")).settings.depthStrength === 100);
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: 1, y: 1 })));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--depth-x") === "14.00px");
  const preview = page.locator(".depth-preview-front");
  assert.notEqual(await preview.evaluate((element) => getComputedStyle(element).transform), "none");
  const output = process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha10/preview";
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: output + "/depth-settings-synthetic.png", fullPage: true });
  await slider.fill("0"); await slider.dispatchEvent("keyup", { key: "ArrowLeft" });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("depth-snapshot")).settings.depthStrength === 0);
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: 1, y: 1 })));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--depth-x") === "0.00px");
  await page.getByRole("switch", { name: /Глубина при наклоне/ }).uncheck();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("depth-snapshot")).settings.depthEffects === false);
  assert.ok(await page.evaluate(() => window.__stops > 0));
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.motion === "full");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.depth), "off");
  assert.equal(await page.getByLabel("Сила наклона").count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("depth-snapshot")).settings.depthStrength), 0);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.evaluate(() => { window.__depthAvailable = false; });
  await page.getByRole("switch", { name: /Глубина при наклоне/ }).check();
  await page.getByRole("status").filter({ hasText: "Датчик наклона недоступен" }).waitFor();
  await page.getByRole("switch", { name: /Глубина при наклоне/ }).uncheck();
  await page.evaluate(() => { window.__depthAvailable = true; window.__depthError = true; });
  await page.getByRole("switch", { name: /Глубина при наклоне/ }).check();
  await page.getByRole("status").filter({ hasText: "Не удалось подключить датчик наклона" }).waitFor();
  await page.getByRole("switch", { name: /Глубина при наклоне/ }).uncheck();
  await page.evaluate(() => { window.__depthError = false; });
  await page.getByRole("switch", { name: /Глубина при наклоне/ }).check();
  await page.getByRole("status").filter({ hasText: "Данные не поступают" }).waitFor();
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: 0, y: 0 })));
  await page.getByRole("status").filter({ hasText: "Датчик работает" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: bounded sensor samples, stable hit target, touch/input/background/reduced-motion gates, preference persistence; mocked native bridge only.");
} finally { await browser.close(); }
