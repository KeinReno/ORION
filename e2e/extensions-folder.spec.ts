import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

/**
 * ADR-0022, E2: the owner's scenario end to end on a running ORION, no rebuild. The API of the suite watches
 * `tmp/e2e-extensions` (playwright.config.ts) and keeps approvals in `tmp/e2e-node`.
 */
const root = resolve(__dirname, "..");
const extensionsDir = join(root, "tmp", "e2e-extensions");
const id = "e2e-hello";
const folder = join(extensionsDir, id);
const cli = (...args: string[]) => execFileSync(process.execPath, [join(root, "scripts", "orion-ext.mjs"), ...args], { cwd: root, encoding: "utf8" });

test("drop a folder, approve once, it runs; dev mode reloads edits; switching off removes it", async ({ page, request }) => {
  test.setTimeout(120_000);
  rmSync(folder, { recursive: true, force: true });
  rmSync(join(root, "tmp", "e2e-node", "extensions.json"), { force: true });
  cli("init", id, "--name", "Привет", "--dir", extensionsDir);

  const account = await register(request, "extensions-folder");
  await signIn(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);

  // Found, waiting for approval
  await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
  const settingsNav = page.getByRole("navigation", { name: "Разделы настроек", exact: true });
  await settingsNav.getByRole("button", { name: "Расширения", exact: true }).click();
  const card = page.getByRole("region", { name: "Расширение Привет", exact: true });
  await expect(card).toContainText("ждёт подтверждения");
  await card.getByRole("button", { name: "Подтвердить и включить", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить и включить", exact: true }).click();
  await expect(card).toContainText("работает");

  // Loaded into the running app: menu item, panel with live data, dashboard card
  const nav = page.getByRole("navigation", { name: "Разделы", exact: true });
  await nav.getByRole("button", { name: "Привет", exact: true }).click();
  await expect(page.getByText("Задач в этом пространстве: 0", { exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Дашборд", exact: true }).click();
  await expect(page.getByRole("region", { name: "Привет", exact: true })).toContainText("Задач: 0");

  // Dev mode: an edit + rebuild shows up without approving again or reloading the page
  await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
  await card.getByRole("switch", { name: "Режим разработчика", exact: true }).click();
  await expect(card).toContainText("режим разработчика");
  const source = join(folder, "src", "index.tsx");
  writeFileSync(source, readFileSync(source, "utf8").replace('ctx.addPanel({ id: "main", label: "Привет"', 'ctx.addPanel({ id: "main", label: "Привет, правка"'));
  cli("build", folder);
  await expect(nav.getByRole("button", { name: "Привет, правка", exact: true })).toBeVisible({ timeout: 20_000 });

  // Switched off: everything it added disappears; data of ORION untouched
  await card.getByRole("switch", { name: "Включено", exact: true }).click();
  await expect(card).toContainText("выключено");
  await expect(nav.getByRole("button", { name: "Привет, правка", exact: true })).toHaveCount(0);

  rmSync(folder, { recursive: true, force: true });
});
