import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test("review, import, reopen and repeat the catalog", async ({ page, request }, testInfo) => {
  const account = await register(request, "orion-dev");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const project = await request.post(`${base}/projects`, { headers, data: { name: "ORION CORE", description: "User description" } });
  expect(project.ok()).toBe(true);
  await signIn(page, account);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/panel/orion-dev?workspaceId=${account.workspaceId}`);
  const importButton = page.getByRole("button", { name: "Импортировать каталог", exact: true });
  await expect(page.getByRole("region", { name: "План импорта" })).toBeVisible();
  await expect(importButton).toBeDisabled();
  await page.getByRole("checkbox", { name: /Связать с существующим проектом/ }).check();
  await expect(importButton).toBeDisabled();
  await page.getByRole("checkbox", { name: /Импортировать этот план/ }).check();
  await expect(importButton).toBeEnabled();
  await page.getByRole("heading", { name: /Пространство:/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("review-desktop.png"), fullPage: true });
  await importButton.click();
  await expect(page.getByRole("region", { name: "Результат импорта" })).toBeVisible();
  const projects = await (await request.get(`${base}/projects`, { headers })).json();
  expect(projects.filter((row: { name: string }) => row.name === "ORION CORE")).toHaveLength(1);
  expect(projects.find((row: { name: string }) => row.name === "ORION CORE").description).toBe("User description");
  await page.reload();
  await expect(page.getByText(/Уже связаны: 29/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("repeat-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("checkbox", { name: /Импортировать этот план/ }).check();
  await importButton.click();
  await expect(page.getByText(/Создано проектов: 0; задач: 0; зависимостей: 0/)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("stale preview preserves review and requires refresh", async ({ page, request }) => {
  const account = await register(request, "orion-dev-stale");
  await signIn(page, account);
  await page.goto(`/panel/orion-dev?workspaceId=${account.workspaceId}`);
  await expect(page.getByRole("region", { name: "План импорта" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Импортировать этот план/ }).check();
  const response = await request.post(`${apiUrl()}/workspaces/${account.workspaceId}/projects`, {
    headers: { Authorization: `Bearer ${account.accessToken}` }, data: { name: "Created after preview" }
  });
  expect(response.ok()).toBe(true);
  await page.getByRole("button", { name: "Импортировать каталог", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "План изменился" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Импортировать этот план/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Импортировать каталог", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Обновить план" }).click();
  await expect(page.getByRole("checkbox", { name: /Импортировать этот план/ })).not.toBeChecked();
});

test("lost apply response recovers from persisted mappings without duplicate writes", async ({ page, request }, testInfo) => {
  const account = await register(request, "orion-dev-lost-response");
  await signIn(page, account);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/panel/orion-dev?workspaceId=${account.workspaceId}`);
  await expect(page.getByRole("region", { name: "План импорта" })).toBeVisible();
  const acknowledgement = page.getByRole("checkbox", { name: /Импортировать этот план/ });
  await acknowledgement.focus();
  await page.keyboard.press("Space");
  await expect(acknowledgement).toBeChecked();
  let applied = 0;
  await page.route("**/development-import/apply", async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    applied++;
    await route.abort("failed"); // commit succeeded, transport lost the response
  });
  const importButton = page.getByRole("button", { name: "Импортировать каталог", exact: true });
  await importButton.click();
  await expect(page.getByRole("alert").filter({ hasText: "Ответ об импорте не получен" })).toBeVisible();
  await expect(importButton).toBeDisabled();
  expect(applied).toBe(1);
  await page.unroute("**/development-import/apply");
  await page.getByRole("button", { name: "Обновить план" }).click();
  await expect(page.getByText(/Уже связаны: 29/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("heading", { name: /Пространство:/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("recovered-320.png"), fullPage: true });
});

test("stalled preview leaves a retry path", async ({ page, request }) => {
  const account = await register(request, "orion-dev-timeout");
  await signIn(page, account);
  await page.route("**/development-import/preview", () => { /* leave transport pending */ });
  await page.goto(`/panel/orion-dev?workspaceId=${account.workspaceId}`);
  await expect(page.getByText("Проверяем каталог и данные пространства…")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось получить план" })).toBeVisible({ timeout: 35_000 });
  await expect(page.getByRole("button", { name: "Обновить план" })).toBeEnabled();
  await page.unroute("**/development-import/preview");
  await page.getByRole("button", { name: "Обновить план" }).click();
  await expect(page.getByRole("region", { name: "План импорта" })).toBeVisible();
});
