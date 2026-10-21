// Synthetic native bridge only: does not prove real Android recognizer availability/quality.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out = "test-results/android-dictation"; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.addInitScript(() => {
    window.androidBridge = {};
    window.__speechMode = "success";
    const methods = {
      App: ["addListener", "removeListener", "exitApp"],
      OrionStorage: ["read", "write", "readReplica", "clearAllReplicas"],
      OrionLan: ["getState"], OrionUpdates: ["getState", "check", "addListener", "removeListener"],
      OrionSpeech: ["getPending", "recognize", "acknowledge"],
    };
    const state = () => ({ installedVersion: "0.1.5", installedCode: 6, lastChecked: Date.now(), lastAttempt: Date.now(), available: false, ready: false, downloading: false, canInstall: false, wifi: false, manifest: null });
    window.Capacitor = {
      PluginHeaders: Object.entries(methods).map(([name, list]) => ({ name, methods: list.map((name) => ({ name, rtype: name === "addListener" ? "callback" : "promise" })) })),
      nativeCallback: () => "test-listener",
      nativePromise: async (plugin, method, options) => {
        if (plugin === "OrionStorage") {
          if (method === "read") return { value: localStorage.getItem("test-snapshot") };
          if (method === "write") { if (window.__diskFail) throw new Error("disk full"); localStorage.setItem("test-snapshot", options.value); return {}; }
          return { value: null };
        }
        if (plugin === "OrionLan") return { paired: false, node: null, user: null, address: "", port: 4443 };
        if (plugin === "OrionUpdates") return state();
        if (plugin === "OrionSpeech") {
          if (method === "getPending") return JSON.parse(localStorage.getItem("test-speech") || '{"id":"","text":""}');
          if (method === "acknowledge") {
            if (window.__ackFail) { window.__ackFail = false; throw new Error("Не удалось завершить обработку диктовки"); }
            localStorage.removeItem("test-speech"); return {};
          }
          if (window.__speechMode === "cancel") return { cancelled: true };
          if (window.__speechMode === "error") throw new Error("Сервис диктовки недоступен");
          const result = { id: crypto.randomUUID(), text: "Позвонить завтра", durable: true };
          localStorage.setItem("test-speech", JSON.stringify(result)); return result;
        }
        return {};
      },
    };
  });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3180");
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Идея");
  await page.getByLabel("Текст заметки", { exact: true }).fill("Написано ранее");
  await page.getByRole("button", { name: "Надиктовать", exact: true }).click();
  await page.getByLabel("Распознанный текст", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Текст заметки", { exact: true }).inputValue(), "Написано ранее");
  await page.evaluate(() => { window.__ackFail = true; });
  await page.getByRole("button", { name: "Добавить в текст", exact: true }).click();
  await page.getByText("Не удалось завершить обработку диктовки", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Добавить в текст", exact: true }).click();
  await page.getByRole("button", { name: "Надиктовать", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Текст заметки", { exact: true }).inputValue(), "Написано ранее\nПозвонить завтра");
  await page.evaluate(() => { window.__speechMode = "cancel"; });
  await page.getByRole("button", { name: "Надиктовать", exact: true }).click();
  await page.getByText("Диктовка отменена. Черновик сохранён.", { exact: true }).waitFor();
  await page.evaluate(() => { window.__speechMode = "error"; });
  await page.getByRole("button", { name: "Надиктовать", exact: true }).click();
  await page.getByText("Сервис диктовки недоступен", { exact: true }).waitFor();
  await page.evaluate(() => { window.__speechMode = "success"; });
  await page.getByRole("button", { name: "Надиктовать", exact: true }).click();
  await page.getByLabel("Распознанный текст", { exact: true }).waitFor();
  await page.reload(); await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await page.getByRole("button", { name: /Продолжить черновик/ }).click();
  await page.getByLabel("Распознанный текст", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Добавить в название", exact: true }).click();
  await page.getByRole("button", { name: "Надиктовать", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Название", { exact: true }).inputValue(), "Идея Позвонить завтра");
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: out + "/dictation-320.png", fullPage: true });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByText("Идея Позвонить завтра", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: speech bridge result, append preservation, ack retry without duplicate, cancel/error, pending restart, title/body, save, 320px; synthetic bridge only.");
} finally { await browser.close(); }
