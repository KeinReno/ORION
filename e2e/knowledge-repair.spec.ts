import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test("knowledge preserves failed edits and fits a narrow panel", async ({ page, request }) => {
  const account = await register(request, "knowledge-repair");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}/knowledge`;
  for (const title of ["Первый материал", "Второй материал"]) {
    const response = await request.post(`${base}/items`, { headers, data: { title, status: "approved", body: "Исходный текст" } });
    expect(response.status()).toBe(201);
  }
  await signIn(page, account);
  await page.goto(`/panel/knowledge?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: /Первый материал/ }).click();
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Первый материал");
  const listReads: string[] = [];
  page.on("request", req => {
    if (req.method() === "GET" && /knowledge\/(items|categories)(\?|$)/.test(req.url())) listReads.push(req.url());
  });
  await page.route("**/knowledge/items/*", async route => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Тестовый сбой" }) });
    else await route.continue();
  });
  await page.getByRole("textbox", { name: "Название", exact: true }).fill("Сохранить мой текст");
  const error = page.getByText("Не удалось сохранить материал", { exact: true });
  await expect(error).toBeVisible();
  await error.locator("../..").getByRole("button", { name: "Закрыть", exact: true }).click();
  const backToReading = page.getByRole("button", { name: "← К чтению", exact: true });
  await backToReading.click();
  await expect(page.getByText("Сначала сохраните материал")).toBeVisible();
  await page.getByText("Сначала сохраните материал", { exact: true }).locator("../..").getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Сохранить мой текст");
  await page.unroute("**/knowledge/items/*");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Сохранено" })).toBeVisible();
  expect(listReads).toEqual([]);
  await backToReading.click();
  await expect(page.getByText("Не удалось сохранить материал")).toBeHidden();
  await expect(page.getByText("Сначала сохраните материал")).toBeHidden({ timeout: 15000 });
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.getByRole("button", { name: "← Библиотека", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/knowledge-narrow.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/knowledge-desktop.png", fullPage: true });
});


test("knowledge keeps source text, backlinks and revision conflicts", async ({ request }) => {
  const account = await register(request, "knowledge-contract");
  await disableAllPlugins(request, account);
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}/knowledge`;
  const create = async (title: string) => {
    const response = await request.post(`${base}/items`, { headers, data: { title, body: "Original body", tags: ["Архитектура"] } });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const first = await create("First");
  const second = await create("Second");
  const sourceText = "  Original source\nDo not normalize.  ";
  const source = await request.post(`${base}/items/${first.id}/sources`, { headers, data: { type: "manual", originalText: sourceText } });
  expect(source.status()).toBe(201);
  expect((await source.json()).originalText).toBe(sourceText);
  const relation = await request.post(`${base}/items/${first.id}/relations`, { headers, data: { toId: second.id } });
  expect(relation.status()).toBe(201);
  const detail = await (await request.get(`${base}/items/${second.id}`, { headers })).json();
  expect(detail.backlinks).toHaveLength(1);
  const saved = await request.patch(`${base}/items/${first.id}`, { headers, data: { body: "Updated", expectedRevision: first.revision } });
  expect(saved.status()).toBe(200);
  const stale = await request.patch(`${base}/items/${first.id}`, { headers, data: { body: "Stale", expectedRevision: first.revision } });
  expect(stale.status()).toBe(409);
  const fresh = await (await request.get(`${base}/items/${first.id}`, { headers })).json();
  expect(fresh.body).toBe("Updated");
  expect(fresh.sources[0].originalText).toBe(sourceText);
  const search = await request.get(`${base}/items?q=${encodeURIComponent("архитектура")}`, { headers });
  expect((await search.json()).map((item: { id: string }) => item.id).sort()).toEqual([first.id, second.id].sort());
  const stranger = await register(request, "knowledge-stranger");
  const denied = await request.get(`${base}/items/${first.id}`, { headers: { Authorization: `Bearer ${stranger.accessToken}` } });
  expect([403, 404]).toContain(denied.status());
});
