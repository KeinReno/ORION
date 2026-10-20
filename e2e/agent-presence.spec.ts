import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

/**
 * «Индикация работы агентов»: an external agent (plain HTTP with its token, as Claude Desktop through MCP does) works in
 * the workspace while the human has ORION open — the shell shows who does what, the touched panel gets a frame, the
 * touched task lights up; everything goes out on its own a few seconds later.
 */
test("an agent at work: pill, panel frame, lit task, feed — and quiet afterwards", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "agent-presence");
  const human = { Authorization: `Bearer ${account.accessToken}` };
  const issued = await request.post(`${apiUrl()}/workspaces/${account.workspaceId}/agent-tokens`, {
    headers: human,
    data: { name: "Claude Desktop", scopes: ["tasks:read", "tasks:write"], expiresInDays: 7 }
  });
  expect(issued.status(), await issued.text()).toBe(201);
  const agent = { Authorization: `Bearer ${((await issued.json()) as { secret: string }).secret}` };

  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Задачи", exact: true }).first().click();
  await expect(page.getByRole("combobox", { name: "Фильтр по сроку", exact: true })).toBeVisible();
  const pill = page.getByRole("button", { name: /^ИИ работает:/ });
  await expect(pill).toHaveCount(0);

  const created = await request.post(`${apiUrl()}/ai/v1/tasks`, { headers: agent, data: { title: "Задача от агента" } });
  expect(created.status(), await created.text()).toBe(201);

  await expect(pill).toBeVisible({ timeout: 10_000 });
  await expect(pill).toContainText("Claude Desktop");
  await expect(page.locator(".agent-frame").first()).toBeVisible();
  const card = page.locator(".agent-touched").filter({ hasText: "Задача от агента" });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "tmp/redesign/agent-presence.png" });

  await pill.click();
  const feed = page.getByRole("region", { name: "Что делают агенты", exact: true });
  await expect(feed).toContainText("Claude Desktop");
  await feed.getByRole("button", { name: "Журнал и подтверждения", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Мои токены", exact: true })).toBeVisible();

  // Nothing new from the agent: the pill and the frame go out by themselves.
  await expect(pill).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".agent-frame")).toHaveCount(0);
});
