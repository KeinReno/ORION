import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

test("project logbook links an existing task and exposes predecessor/successor directions", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await register(request, "project-logbook");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const addProject = async (name: string) => {
    const response = await request.post(`${base}/projects`, { headers, data: { name } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<{ id: string }>;
  };
  const qa2 = await addProject("QA-v2");
  await addProject("QA-v3");
  const taskResponse = await request.post(`${base}/tasks`, { headers, data: { title: "Проверить восстановление", description: "Исходное описание", projectId: qa2.id, status: "todo" } });
  expect(taskResponse.ok(), await taskResponse.text()).toBe(true);
  const task = await taskResponse.json() as { id: string };

  await signIn(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await page.getByRole("button", { name: "Открыть проект «QA-v2»", exact: true }).click();
  await page.getByRole("tab", { name: /^Задачи/ }).click();
  await page.getByRole("tablist", { name: "Вид задач" }).getByRole("tab", { name: "Список", exact: true }).click();
  await expect(page.locator('[draggable="true"]').filter({ hasText: "Проверить восстановление" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await page.getByRole("button", { name: "Открыть проект «QA-v3»", exact: true }).click();
  await page.getByRole("tab", { name: "Журнал", exact: true }).click();

  await page.getByRole("combobox", { name: "Тип записи" }).selectOption("decision");
  await page.getByRole("textbox", { name: "Текст записи журнала" }).fill("Берём проверку в текущий цикл");
  await page.getByLabel("Задачи, связанные с новой записью").evaluate((target, taskId) => {
    const transfer = new DataTransfer();
    transfer.setData("application/x-orion-task", taskId);
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, task.id);
  await page.getByRole("textbox", { name: "Комментарий к задаче Проверить восстановление" }).fill("Нужна проверка на чистом профиле");
  await page.getByRole("button", { name: "Добавить запись", exact: true }).click();
  await expect(page.getByText("Берём проверку в текущий цикл", { exact: true })).toBeVisible();
  await expect(page.getByText("Нужна проверка на чистом профиле", { exact: true })).toBeVisible();
  await expect(page.getByText("QA-v2 · todo", { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Тип связи" }).selectOption("continues");
  await page.getByRole("combobox", { name: "Связанный проект" }).selectOption(qa2.id);
  await page.getByRole("button", { name: "Добавить связь", exact: true }).click();
  const predecessors = page.getByRole("heading", { name: "Предшественники" }).locator("xpath=../..");
  await expect(predecessors).toContainText("QA-v2");

  const savedTask = await request.get(`${base}/tasks`, { headers });
  expect(savedTask.ok()).toBe(true);
  const savedTasks = await savedTask.json() as Array<{ id: string; title: string; description: string | null; projectId: string | null }>;
  expect(savedTasks.find((item) => item.id === task.id)).toMatchObject({ title: "Проверить восстановление", description: "Исходное описание", projectId: qa2.id });

  mkdirSync("tmp/project-logbook", { recursive: true });
  await page.screenshot({ path: "tmp/project-logbook/desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("combobox", { name: "Раздел проекта", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Бортовой журнал", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "tmp/project-logbook/mobile.png", fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await page.getByRole("button", { name: "Открыть проект «QA-v2»", exact: true }).click();
  await page.getByRole("tab", { name: "Журнал", exact: true }).click();
  const successors = page.getByRole("heading", { name: "Последователи" }).locator("xpath=../..");
  await expect(successors).toContainText("QA-v3");
});
