import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test("confirmed task rule publishes through the existing shared UI and withdrawal removes access", async ({ page, request }) => {
  const owner = await register(request, "rule-owner");
  const headers = { Authorization: `Bearer ${owner.accessToken}` };
  const zoneResponse = await request.post(`${apiUrl()}/workspaces`, { headers, data: { name: "Зона правил" } });
  expect(zoneResponse.status()).toBe(201); const zone = await zoneResponse.json();
  const taskResponse = await request.post(`${apiUrl()}/workspaces/${owner.workspaceId}/tasks`, { headers, data: { title: "Автоматическая публикация", description: "Текст без разрешения", status: "todo" } });
  expect(taskResponse.status()).toBe(201); const task = await taskResponse.json();
  const ruleResponse = await request.post(`${apiUrl()}/publication-rules`, { headers, data: { sourceWorkspaceId: owner.workspaceId, workspaceId: zone.id, name: "Задачи для зоны", statuses: ["todo"] } });
  expect(ruleResponse.status()).toBe(201); const rule = await ruleResponse.json();
  const previewResponse = await request.get(`${apiUrl()}/publication-rules/${rule.id}/preview`, { headers });
  expect(previewResponse.ok()).toBe(true); const preview = await previewResponse.json();
  expect(preview.items[0].content.text).toBe("");
  expect((await request.post(`${apiUrl()}/publication-rules/${rule.id}/enable`, { headers, data: { expectedRevision: rule.revision, fingerprint: preview.fingerprint, consentFutureRecords: true } })).status()).toBe(201);
  await signIn(page, owner);
  await page.goto(`/panel/shared?workspaceId=${owner.workspaceId}`);
  const card = page.getByRole("article", { name: "Автоматическая публикация", exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByText("Текст без разрешения")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Изменить статус", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const update = await request.patch(`${apiUrl()}/workspaces/${owner.workspaceId}/tasks/${task.id}`, { headers, data: { status: "done" } });
  expect(update.ok()).toBe(true);
  // Real production outbox cron; there is no test-only dispatch endpoint.
  await expect.poll(async () => {
    const result = await request.get(`${apiUrl()}/publications?workspaceId=${zone.id}`, { headers });
    return (await result.json()).length;
  }, { timeout: 25000 }).toBe(0);
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(card).toHaveCount(0);
});
