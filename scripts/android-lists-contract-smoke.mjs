import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const open = () => page.goto("http://127.0.0.1:3180/tests/lists-contract.html");
  await open();
  const remove = page.getByRole("button", { name: "Удалить список…", exact: true });
  await expect(remove).toBeDisabled();
  await expect(page.locator("#list-delete-archive-help")).toBeVisible();
  assert.equal(await page.evaluate(() => window.listContract.mutations.length), 0);
  await page.getByRole("button", { name: "В архив", exact: true }).click();
  await expect(remove).toBeEnabled(); await remove.click();
  await page.evaluate(() => window.listContract.unarchive());
  await expect(page.getByRole("button", { name: "Удалить список", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("больше не в архиве");
  assert.equal(await page.evaluate(() => window.listContract.mutations.filter(m => m.kind === "delete").length), 0);
  await page.getByRole("button", { name: "Оставить", exact: true }).click();
  await page.getByRole("button", { name: "В архив", exact: true }).click();
  await remove.click(); await page.getByRole("button", { name: "Удалить список", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.listContract.mutations.map(m => m.kind)), ["patch", "patch", "delete"]);
  await open(); await page.evaluate(() => window.listContract.local());
  await expect(remove).toBeEnabled(); assert.deepEqual(errors, []);
  console.log("PASS: remote archive prerequisite, concurrent unarchive guard, ordered archive/delete, unchanged local delete; browser component fixture only.");
} finally { await browser.close(); }
