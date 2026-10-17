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

/** Moves the leaf that holds `panelId` out of the tiled grid into an off-screen floating group; returns the saved key. */
async function floatPanelOffScreen(page: import("@playwright/test").Page, panelId: string, replaceGridWithUnknown: boolean): Promise<void> {
  await page.evaluate(({ panelId, replaceGridWithUnknown }) => {
    const key = Object.keys(window.localStorage).find(k => k.startsWith("orion.dockLayout:main:"))!;
    const layout = JSON.parse(window.localStorage.getItem(key)!);
    type Node = { type: string; data: unknown; size?: number };
    let moved: { id: string; views: string[]; activeView?: string } | null = null;
    const walk = (node: Node): void => {
      if (node.type !== "branch") return;
      const children = node.data as Node[];
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]!;
        if (child.type === "leaf") {
          const data = child.data as { id: string; views: string[]; activeView?: string };
          if (data.views.includes(panelId)) { moved = { ...data, views: [panelId], activeView: panelId }; data.views = data.views.filter(v => v !== panelId); if (data.views.length === 0) children.splice(i, 1); else data.activeView = data.views[0]; }
        } else walk(child);
      }
    };
    walk(layout.grid.root);
    if (replaceGridWithUnknown) {
      layout.panels["ghost-grid"] = { id: "ghost-grid", contentComponent: "ghost-grid", title: "Призрак" };
      layout.grid.root = { type: "branch", size: layout.grid.height, data: [{ type: "leaf", size: layout.grid.width, data: { id: "ghost-leaf", views: ["ghost-grid"], activeView: "ghost-grid" } }] };
    }
    layout.floatingGroups = [{ data: moved, position: { left: 9000, top: 9000, width: 520, height: 420 } }];
    window.localStorage.setItem(key, JSON.stringify(layout));
  }, { panelId, replaceGridWithUnknown });
}

test("a real floating tab is pulled back on screen and stays usable", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "layout-floating");
  await signIn(page, account); await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await expect(page.locator(".dv-tab").filter({ hasText: "Заметки" })).toHaveCount(1);
  await page.waitForTimeout(800);
  await floatPanelOffScreen(page, "notes", false);
  await page.reload();
  await expect(page.getByText("Рабочее место восстановлено частично", { exact: true })).toBeVisible();
  const tab = page.locator(".dv-tab").filter({ hasText: "Заметки" });
  await expect(tab).toHaveCount(1);
  await expect(tab).toBeVisible();
  const box = await tab.boundingBox();
  expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1400 && box.y + box.height <= 800).toBe(true);
  // The panel itself works: its create button is reachable and opens the editor.
  await tab.click();
  await page.getByRole("button", { name: "Новая", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Название заметки", exact: true })).toBeVisible();
});

test("a real floating tab survives when the tiled grid held only an unknown tab", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "layout-grid-empty");
  await signIn(page, account); await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await page.waitForTimeout(800);
  await floatPanelOffScreen(page, "notes", true);
  await page.reload();
  const tab = page.locator(".dv-tab").filter({ hasText: "Заметки" });
  await expect(tab).toHaveCount(1);
  await expect(tab).toBeVisible();
  await expect(page.locator(".dv-tab").filter({ hasText: "Призрак" })).toHaveCount(0);
  await expect(page.getByText("Рабочее место восстановлено частично", { exact: true })).toBeVisible();
});
