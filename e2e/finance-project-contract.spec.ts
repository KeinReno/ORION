import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });
for (const pluginsOff of [false, true]) {
  test(`project costs keeps currency totals and optional tab (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    const account = await register(request, "finance-project-contract");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` }, base = `${apiUrl()}/workspaces/${account.workspaceId}`;
    const post = async (path: string, data: object) => {
      const response = await request.post(`${base}/${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true); return response.json();
    };
    const project = await post("projects", { name: "Контракт финансов", currency: "USD" });
    for (const [currency, amount] of [["USD", 12345], ["RUB", 54321]] as const) {
      const source = await post("finance/accounts", { name: currency, currency, startingBalance: 0 });
      await post("finance/transactions", { accountId: source.id, type: "expense", projectId: project.id,
        occurredAt: "2026-11-01T10:00:00Z", lines: [{ categoryId: null, amount }] });
    }
    await signIn(page, account); await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Проекты", exact: true }).click();
    await page.getByRole("button", { name: "Открыть проект «Контракт финансов»", exact: true }).click();
    const costsTab = page.getByRole("tab", { name: "Затраты", exact: true });
    if (pluginsOff) {
      await expect(costsTab).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Обзор", exact: true })).toBeVisible();
      const operations = await request.get(`${base}/finance/transactions`, { headers });
      expect(operations.ok()).toBe(true);
      return;
    }
    await costsTab.click();
    const currencies = page.getByRole("tablist", { name: "Валюта затрат", exact: true });
    await expect(currencies.getByRole("tab", { name: "USD", exact: true })).toHaveAttribute("aria-selected", "true");
    const spending = page.locator("p").filter({ hasText: /^Потрачено$/ }).locator("..");
    await expect(spending).toContainText(/123[,.]45/);
    await currencies.getByRole("tab", { name: "RUB", exact: true }).click();
    await expect(spending).toContainText(/543[,.]21/);
    await page.reload();
    await page.getByRole("tab", { name: "Затраты", exact: true }).click();
    await expect(page.getByRole("tablist", { name: "Валюта затрат", exact: true })).toBeVisible();
  });
}
