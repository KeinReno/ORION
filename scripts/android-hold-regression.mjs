import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await page.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:3180"); await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  await page.evaluate(() => document.addEventListener("pointerdown", (event) => { window.__pointer = event.pointerId; }, true));
  const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  for (let index = 0; index < 8; index++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 16, y: 480 + index * 3 }] });
    await page.waitForTimeout(480);
    const dialog = page.getByRole("dialog", { name: "Быстрые действия" }); await dialog.waitFor();
    // Android implicit capture transfers from a descendant to the host. Its loss bubbles.
    await page.evaluate(() => document.querySelector(".content").dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: window.__pointer })));
    assert.equal(await dialog.isVisible(), true, "descendant capture loss closed menu");
    if (index % 2) await page.evaluate(() => document.querySelector(".gesture-root").dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: window.__pointer })));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.getByText("Выберите действие", { exact: true }).waitFor();
    assert.equal(await dialog.isVisible(), true, "release/cancel must leave tappable fallback");
    await dialog.getByRole("button", { name: "Отменить быстрые действия", exact: true }).click();
    assert.equal(await dialog.count(), 0, "first deliberate tap after hold must work");
  }
  console.log("PASS: 8 touch holds, bubbled capture transfer, pointer cancellation, release latch and first explicit tap; Chromium emulation only.");
} finally { await browser.close(); }
