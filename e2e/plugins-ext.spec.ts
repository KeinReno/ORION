import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

/**
 * A plugin declared only by `apps/web/plugins-ext/<id>/plugin.manifest.json` (no core file lists it) reaches its slot,
 * and the workspace switch for plugins turns it off — the same lifecycle as a plugin of the main build.
 */
test("manifest plugin habits-insights fills its slot and follows the plugin switch", async ({ page, request }) => {
  const account = await register(request, "plugins-ext");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const habit = await request.post(`${apiUrl()}/workspaces/${account.workspaceId}/habits`, { headers, data: { name: "Зарядка" } });
  expect(habit.ok(), await habit.text()).toBe(true);
  const plugins = await (await request.get(`${apiUrl()}/workspaces/${account.workspaceId}/plugins`, { headers })).json();
  expect(plugins.find((item: { id: string }) => item.id === "habits-insights")).toMatchObject({ enabled: true, extendsModuleId: "habits" });

  await signIn(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("navigation", { name: "Разделы", exact: true }).getByRole("button", { name: "Привычки", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Неделя", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Активность", exact: true })).toBeVisible();

  const off = await request.patch(`${apiUrl()}/workspaces/${account.workspaceId}/plugins/habits-insights`, { headers, data: { enabled: false } });
  expect(off.ok(), await off.text()).toBe(true);
  await page.reload();
  await expect(page.getByText("Зарядка", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Неделя", exact: true })).toHaveCount(0);
});
