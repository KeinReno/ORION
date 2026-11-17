import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

// Architect / Workbench: процессы (воркфлоу), пустой старт без проектов по умолчанию.
test("workbench: empty start, create a workflow process, edit and reopen", async ({ page, request }) => {
  const account = await register(request, "orion-dev");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const pageErrors: string[] = [];
  await signIn(page, account);
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto(`/panel/orion-dev?workspaceId=${account.workspaceId}`);

  // Панель переименована в Architect, первый экран — «Процессы» без ORION-проектов по умолчанию.
  await expect(page.getByRole("button", { name: "Процессы", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Архитектура", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Git", exact: true })).toBeVisible();
  await expect(page.getByText("Создайте первый процесс — визуальную схему работы над задачей")).toBeVisible();
  await expect(page.getByText("Импорт каталога")).toHaveCount(0);

  // Создаём процесс через UI.
  await page.getByRole("button", { name: "Новый процесс", exact: true }).click();
  await page.getByPlaceholder("Например, Проверка релиза 0.24").fill("Разработка модуля");
  await page.getByRole("button", { name: "Создать процесс", exact: true }).click();

  // Процесс появился в списке, открывается редактор со схемой.
  await expect(page.getByText("Разработка модуля")).toBeVisible();
  await page.getByText("Разработка модуля").click();
  await expect(page.getByLabel("Схема процесса")).toBeVisible();
  await expect(page.getByLabel("Добавить узел")).toBeVisible();

  // Добавляем узлы: Задача → Агент → Результат.
  await page.getByRole("button", { name: /Задача/ }).click();
  await page.getByRole("button", { name: /Агент/ }).click();
  await page.getByRole("button", { name: /Результат/ }).toHaveCount(1);
  await page.getByLabel("Название процесса").fill("Разработка модуля v2");
  await page.getByRole("button", { name: "К процессам" }).click();
  await expect(page.getByText("Разработка модуля v2")).toBeVisible();

  // Граф сохранился на сервере.
  const list = await (await request.get(`${base}/development/workflows`, { headers })).json();
  const saved = list.find((row: { name: string }) => row.name === "Разработка модуля v2");
  expect(saved).toBeTruthy();
  const full = await (await request.get(`${base}/development/workflows/${saved.id}`, { headers })).json();
  expect(full.nodes.map((node: { type: string }) => node.type).sort()).toEqual(["agent", "result", "task"]);
  expect(pageErrors).toEqual([]);
});

test("workbench: workflows API validates input and isolates workspaces", async ({ request }) => {
  const account = await register(request, "orion-dev");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}/development/workflows`;

  const created = await request.post(base, { headers, data: { name: "API-процесс" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  const bad = await request.post(base, { headers, data: { name: "" } });
  expect(bad.status()).toBe(400);

  const node = { id: "n1", type: "task", title: "Задача", description: "", agentName: "", status: "pending", x: 0, y: 0 };
  const updated = await request.put(`${base}/${id}`, { headers, data: { nodes: [node], edges: [] } });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).nodes).toHaveLength(1);

  const other = await register(request, "orion-dev");
  const foreign = await request.get(`${apiUrl()}/workspaces/${other.workspaceId}/development/workflows/${id}`, {
    headers: { Authorization: `Bearer ${other.accessToken}` }
  });
  expect(foreign.status()).toBe(404);

  expect((await request.delete(`${base}/${id}`, { headers })).status()).toBe(204);
});
