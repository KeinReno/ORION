// Synthetic sensor/native preference bridge: hardware sensor acceptance remains separate.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
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
        if (plugin === "OrionDepth") { if (method === "start") { window.__starts++; return { available: true }; } if (method === "stop") window.__stops++; return {}; }
        if (plugin === "OrionUpdates") return { installedVersion: "0.1.8", installedCode: 9, lastChecked: Date.now(), lastAttempt: Date.now(), available: false, ready: false, manifest: null, wifi: false };
        return {};
      },
    };
  });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3180");
  await page.waitForFunction(() => document.documentElement.dataset.depth === "active");
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: .6, y: -.4 })));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--depth-x") === "1.50px");
  const button = page.getByRole("button", { name: "Создать", exact: true }); const before = await button.boundingBox();
  await page.evaluate(() => window.__callbacks["OrionDepth:tilt"].forEach((callback) => callback({ x: -1, y: 1 })));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--depth-x") === "-2.50px");
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
  await page.getByRole("switch", { name: /Глубина при наклоне/ }).uncheck();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("depth-snapshot")).settings.depthEffects === false);
  assert.ok(await page.evaluate(() => window.__stops > 0));
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.motion === "full");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.depth), "off");
  assert.deepEqual(errors, []);
  console.log("PASS: bounded sensor samples, stable hit target, touch/input/background/reduced-motion gates, preference persistence; mocked native bridge only.");
} finally { await browser.close(); }
