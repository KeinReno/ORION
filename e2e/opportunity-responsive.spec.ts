import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test("all Hub tabs fit at 320px with long names and remain reachable by keyboard", async ({ page, request }, testInfo) => {
  const a = await register(request, "hub-320");
  const base = `${apiUrl()}/workspaces/${a.workspaceId}`; const headers = { Authorization: `Bearer ${a.accessToken}` };
  for (const id of ["opportunities-profiles", "opportunities-hh-import", "opportunities-assistant", "opportunities-execution", "opportunities-manager"]) expect((await request.patch(`${base}/plugins/${id}`, { headers, data: { enabled: true } })).ok()).toBe(true);
  expect((await request.post(`${base}/opportunity-profiles`, { headers, data: { displayName: "Кандидат".repeat(20), acknowledgeWorkspaceVisibility: true } })).ok()).toBe(true);
  expect((await request.post(`${base}/opportunities`, { headers, data: { kind: "job", title: "Аналитик".repeat(25), organizationName: "Организация".repeat(15) } })).ok()).toBe(true);
  await signIn(page, a); await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/panel/opportunities?workspaceId=${a.workspaceId}`);
  const nav = page.getByRole("navigation", { name: "Разделы возможностей" });
  for (const tab of ["Вакансии и заказы", "Профили", "Импорт HH", "Отправка", "Менеджер"]) {
    const button = nav.getByRole("button", { name: tab, exact: true });
    await button.focus(); await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    if (tab === "Профили") {
      await expect(page.getByRole("button", { name: "Кандидат".repeat(20), exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("hub-profiles-320.png") });
    }
    if (tab === "Вакансии и заказы") await expect(page.getByRole("button", { name: /АналитикАналитикАналитик/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), tab).toBeLessThanOrEqual(1);
    // Dock/PanelBody can hide overflow from documentElement; assert the actual scroll surface too.
    expect(await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll(".orion-scroll")].filter((el) => el.clientWidth > 0).map((el) => el.scrollWidth - el.clientWidth))), `${tab}: panel content`).toBeLessThanOrEqual(1);
  }
});
