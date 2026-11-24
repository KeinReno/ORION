import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test("предпросмотр переноса не сохраняет время, подтверждение сохраняет его", async ({ page, request }) => {
  const account = await register(request, "planning-preview");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const initial = new Date();
  initial.setUTCMinutes(0, 0, 0);
  const target = new Date(initial.getTime() + 2 * 3_600_000);
  const task = await request.post(`${base}/tasks`, {
    headers, data: { title: "Задача для планирования", estimatedMinutes: 60 }
  });
  expect(task.status(), await task.text()).toBe(201);
  const event = await request.post(`${base}/events`, {
    headers, data: { title: "Встреча в новом окне", startAt: target.toISOString(), endAt: new Date(target.getTime() + 3_600_000).toISOString() }
  });
  expect(event.status(), await event.text()).toBe(201);
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByText("Задача для планирования", { exact: true }).first().click();
  await page.getByRole("region", { name: "Детали задачи" }).getByRole("button", { name: "Действия" }).click();
  await page.getByRole("menuitem", { name: "Запланировать…" }).click();
  const newBlock = page.getByRole("dialog", { name: "Новый тайм-блок" });
  await expect(newBlock.getByLabel("Связанная задача")).toHaveValue((await task.json() as { id: string }).id);
  await expect(newBlock.getByLabel("Длительность, мин")).toHaveValue("60");
  await newBlock.getByRole("textbox", { name: "Название" }).fill("Блок для переноса");
  await newBlock.getByLabel("Начало").fill(new Date(initial.getTime() + 3 * 3_600_000).toISOString().slice(0, 16));
  await newBlock.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(newBlock).toHaveCount(0);
  const blocks = await (await request.get(`${base}/planning/blocks`, { headers })).json() as { id: string; title: string }[];
  const block = blocks.find((item) => item.title === "Блок для переноса");
  expect(block).toBeDefined();
  const readStart = async () => (await (await request.get(`${base}/planning/blocks/${block?.id}`, { headers })).json()).startAt;
  const openBlock = () => page.getByText("Блок для переноса", { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Перенести тайм-блок" });
  const targetLocal = new Date(target.getTime() + 3 * 3_600_000).toISOString().slice(0, 16);
  const preview = async () => {
    await openBlock();
    await dialog.getByLabel("Начало").fill(targetLocal);
    await dialog.getByRole("button", { name: "Проверить перенос" }).click();
    await expect(dialog.getByText("Встреча в новом окне · 60 мин")).toBeVisible();
  };
  await preview();
  expect(await readStart()).toBe(initial.toISOString());
  await dialog.getByRole("button", { name: "Отмена" }).click();
  expect(await readStart()).toBe(initial.toISOString());
  await preview();
  await dialog.getByRole("button", { name: "Подтвердить перенос" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(readStart).toBe(target.toISOString());
});

test("портфель открывает проект, а личный черновик заметки восстанавливается после перезагрузки", async ({ page, request }) => {
  const account = await register(request, "project-notes");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const created = await request.post(`${base}/projects`, { headers, data: { name: "Проверка портфеля" } });
  expect(created.status(), await created.text()).toBe(201);
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await page.getByRole("button", { name: "Портфель", exact: true }).click();
  const portfolio = page.getByRole("dialog", { name: "Портфель проектов" });
  await portfolio.getByRole("button", { name: "Проверка портфеля" }).click();
  await expect(portfolio).toHaveCount(0);
  await expect(page.locator(".dv-tab").filter({ hasText: "Проверка портфеля" })).toHaveCount(1);

  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await page.getByRole("button", { name: "Новая", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Название заметки", exact: true });
  await title.fill("Незавершённая личная заметка");
  await page.getByRole("button", { name: "Свойства, связи и доступ" }).click();
  const privateNote = page.getByRole("checkbox", { name: "Личная — видна только вам" });
  await privateNote.check();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) =>
    key.includes(":new-note:") && localStorage.getItem(key)?.includes("Незавершённая личная заметка")
  ))).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  if (!(await title.isVisible())) await page.getByRole("button", { name: "Новая", exact: true }).click();
  await expect(title).toHaveValue("Незавершённая личная заметка");
  await page.getByRole("button", { name: "Свойства, связи и доступ" }).click();
  await expect(privateNote).toBeChecked();
});

test("проект создаётся из шаблона, недельный план сохраняется через интерфейс", async ({ page, request }) => {
  const account = await register(request, "template-time");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const template = await request.post(`${base}/projects/templates`, {
    headers, data: { name: "Шаблон запуска", structure: { name: "Базовый проект" } }
  });
  expect(template.status(), await template.text()).toBe(201);
  const { id } = await template.json() as { id: string };
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await page.getByRole("button", { name: "Из шаблона", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Проект из шаблона" });
  await dialog.getByRole("combobox", { name: "Шаблон", exact: true }).selectOption(id);
  await dialog.getByLabel("Название проекта").fill("Проект из тестового шаблона");
  await dialog.getByRole("button", { name: "Создать проект" }).click();
  await expect(page.locator(".dv-tab").filter({ hasText: "Проект из тестового шаблона" })).toHaveCount(1);
  await page.getByRole("button", { name: "Время", exact: true }).click();
  const minutes = page.getByRole("spinbutton", { name: "План в минутах" });
  await minutes.fill("90");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText(/^План: 1.+30/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Время", exact: true }).click();
  await expect(minutes).toHaveValue("90");
});
