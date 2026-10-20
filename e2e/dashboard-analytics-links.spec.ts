import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

test("dashboard analytics: a figure opens the list it counts, the agents block opens AI agents settings", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "analytics-links");
  // One agent call, so the AI block has figures (an empty journal shows only a hint).
  const issued = await request.post(`${apiUrl()}/workspaces/${account.workspaceId}/agent-tokens`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    data: { name: "Claude E2E", scopes: ["tasks:read"], expiresInDays: 7 }
  });
  const secret = ((await issued.json()) as { secret: string }).secret;
  expect((await request.get(`${apiUrl()}/ai/v1/tasks`, { headers: { Authorization: `Bearer ${secret}` } })).status()).toBe(200);
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  const analytics = page.getByRole("region", { name: "Аналитика", exact: true });

  await analytics.getByRole("tab", { name: "Личный", exact: true }).click();
  await analytics.getByRole("button", { name: /просрочено$/ }).click();
  await expect(page.getByRole("combobox", { name: "Фильтр по сроку", exact: true })).toHaveValue("overdue");

  await page.locator(".dv-tab").filter({ hasText: /Дашборд|Сегодня/ }).first().click();
  await analytics.getByRole("tab", { name: "ИИ", exact: true }).click();
  await analytics.getByRole("button", { name: /агентов$/ }).click();
  await expect(page.getByRole("heading", { name: "Подключённые программы", exact: true })).toBeVisible();
  await expect(page.getByText("Только ваши агенты и только в пространстве", { exact: false })).toBeVisible();
});
