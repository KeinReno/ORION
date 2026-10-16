import { expect, test } from "@playwright/test";
import { register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

test("a saved layout with an unknown panel and an off-screen floating group restores the rest safely", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "layout-recovery");
  await signIn(page, account); await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await expect(page.locator(".dv-tab").filter({ hasText: "Заметки" })).toHaveCount(1);
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find(k => k.startsWith("orion.dockLayout:main:"))!;
    const layout = JSON.parse(window.localStorage.getItem(key)!);
    layout.panels["ghost-plugin"] = { id: "ghost-plugin", contentComponent: "ghost-plugin", title: "Исчезнувший плагин" };
    const firstLeaf = (node: { type: string; data: unknown }): { views: string[] } | null =>
      node.type === "leaf" ? (node.data as { views: string[] }) : ((node.data as { type: string; data: unknown }[]).map(firstLeaf).find(Boolean) ?? null);
    firstLeaf(layout.grid.root)!.views.push("ghost-plugin");
    layout.floatingGroups = [{ data: { id: "float-ghost", views: ["ghost-two"], activeView: "ghost-two" }, position: { left: 9000, top: 9000, width: 500, height: 400 } }];
    layout.panels["ghost-two"] = { id: "ghost-two", contentComponent: "ghost-two", title: "Ещё один" };
    window.localStorage.setItem(key, JSON.stringify(layout));
  });
  await page.reload();
  await expect(page.getByText("Рабочее место восстановлено частично", { exact: true })).toBeVisible();
  await expect(page.locator(".dv-tab").filter({ hasText: "Задачи" })).toHaveCount(1);
  await expect(page.locator(".dv-tab").filter({ hasText: "Заметки" })).toHaveCount(1);
  await expect(page.locator(".dv-tab").filter({ hasText: "Исчезнувший" })).toHaveCount(0);
  await expect(page.locator(".dv-tab").filter({ hasText: "Ещё один" })).toHaveCount(0);

  // Garbage in the slot falls back to the dashboard instead of a blank workspace.
  await page.evaluate(() => { const key = Object.keys(window.localStorage).find(k => k.startsWith("orion.dockLayout:main:"))!; window.localStorage.setItem(key, "{\"grid\":1}"); });
  await page.reload();
  await expect(page.locator(".dv-tab").filter({ hasText: "Дашборд" })).toHaveCount(1);
});
