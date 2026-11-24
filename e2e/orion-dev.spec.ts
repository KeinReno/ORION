import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

  // Architect has independent architecture, codebase and workflow modes.
  await expect(page.getByRole("button", { name: "Кодовая база", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Архитектура", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Процессы команды", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Кодовая база", exact: true }).click();
  await expect(page.getByRole("button", { name: "Карта проекта", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "История Git", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Процессы команды", exact: true }).click();
  await expect(page.getByText("Создайте первый процесс — визуальную схему работы над задачей")).toBeVisible();
  await expect(page.getByText("Импорт каталога")).toHaveCount(0);

  // Создаём процесс через UI.
  await page.getByRole("button", { name: "Новый процесс", exact: true }).last().click();
  await page.getByPlaceholder("Например, Проверка релиза 0.24").fill("Разработка модуля");
  await page.getByRole("button", { name: "Создать процесс", exact: true }).click();

  // Создание сразу открывает редактор.
  await expect(page.getByLabel("Название процесса")).toHaveValue("Разработка модуля");
  await expect(page.getByLabel("Схема процесса")).toBeVisible();

  // Первый узел читается без зума, а последующие не перекрывают его.
  await page.getByRole("button", { name: "Инструменты процесса" }).click();
  const palette = page.getByLabel("Добавить узел");
  await palette.getByRole("button", { name: "Задача", exact: true }).click();
  const firstNode = page.locator(".react-flow__node").first();
  await expect.poll(async () => (await firstNode.boundingBox())?.width ?? 0).toBeGreaterThan(190);
  const canvasToolbar = page.getByRole("toolbar", { name: "Управление схемой" });
  await expect(canvasToolbar).toBeVisible();
  const toolbarBounds = await canvasToolbar.boundingBox();
  const flowBounds = await page.getByLabel("Схема процесса").boundingBox();
  expect(toolbarBounds && flowBounds).toBeTruthy();
  expect(toolbarBounds!.y + toolbarBounds!.height).toBeLessThanOrEqual(flowBounds!.y + flowBounds!.height);
  expect(toolbarBounds!.y + toolbarBounds!.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
  await expect(page.getByRole("button", { name: /Состояние узлов/ })).toHaveAttribute("aria-expanded", "false");

  // Контекстное меню дублирует узел, а undo/redo возвращают состав схемы.
  await firstNode.click({ button: "right" });
  await page.getByRole("group", { name: "Действия узла" }).getByRole("button", { name: "Дублировать узел" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  // Узел из контекстного меню появляется по координате курсора; это действие тоже отменяется.
  const canvasBox = await page.getByLabel("Схема процесса").boundingBox();
  expect(canvasBox).toBeTruthy();
  const contextPoint = { x: canvasBox!.x + canvasBox!.width * 0.7, y: canvasBox!.y + canvasBox!.height * 0.45 };
  await page.mouse.click(contextPoint.x, contextPoint.y, { button: "right" });
  await page.getByRole("group", { name: "Добавить узел на холст" }).getByRole("button", { name: "Агент", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  const contextNode = page.locator(".react-flow__node").filter({ hasText: "Агент" }).last();
  const contextNodeBox = await contextNode.boundingBox();
  expect(contextNodeBox).toBeTruthy();
  expect(Math.abs(contextNodeBox!.x + contextNodeBox!.width / 2 - contextPoint.x)).toBeLessThan(12);
  expect(Math.abs(contextNodeBox!.y + contextNodeBox!.height / 2 - contextPoint.y)).toBeLessThan(12);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  await palette.getByRole("button", { name: "Агент", exact: true }).click();
  await palette.getByRole("button", { name: "Доказательство", exact: true }).click();
  await palette.getByRole("button", { name: "Решение", exact: true }).click();
  await palette.getByRole("button", { name: "Результат", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);

  // Инспектор показывает соседние узлы и удаляет связь без поиска линии на холсте.
  const taskNode = page.locator(".react-flow__node").filter({ hasText: "Задача" }).first();
  const agentNode = page.locator(".react-flow__node").filter({ hasText: "Агент" }).first();
  const output = await taskNode.locator(".react-flow__handle-right").boundingBox();
  const input = await agentNode.locator(".react-flow__handle-left").boundingBox();
  expect(output).toBeTruthy();
  expect(input).toBeTruthy();
  await page.mouse.move(output!.x + output!.width / 2, output!.y + output!.height / 2);
  await page.mouse.down();
  await page.mouse.move(input!.x + input!.width / 2, input!.y + input!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await taskNode.click();
  await expect(page.getByLabel("Связи узла")).toContainText("Агент");
  await page.getByRole("button", { name: "Удалить связь с «Агент»" }).click();
  await expect(page.getByLabel("Связи узла")).toContainText("Пока нет связей");

  await page.getByLabel("Название процесса").fill("Разработка модуля v2");
  await page.getByRole("button", { name: "К процессам" }).click();
  await expect(page.getByText("Разработка модуля v2")).toBeVisible();

  // Граф сохранился на сервере.
  const list = await (await request.get(`${base}/development/workflows`, { headers })).json();
  const saved = list.find((row: { name: string }) => row.name === "Разработка модуля v2");
  expect(saved).toBeTruthy();
  const full = await (await request.get(`${base}/development/workflows/${saved.id}`, { headers })).json();
  expect(full.nodes.map((node: { type: string }) => node.type).sort()).toEqual(["agent", "decision", "evidence", "result", "task"]);
  await page.getByRole("button", { name: /Разработка модуля v2.*Черновик/ }).click();
  await expect(page.getByLabel("Название процесса")).toHaveValue("Разработка модуля v2");
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Свойства узла", { exact: true })).toBeHidden();
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

test("architect: design software architecture and persist nodes and relations", async ({ page, request }) => {
  const account = await register(request, "orion-dev");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  await signIn(page, account);
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`/panel/orion-dev?workspaceId=${account.workspaceId}`);

  await expect(page.getByRole("button", { name: "Кодовая база", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Архитектура", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Процессы команды", exact: true })).toBeVisible();
  await expect(page.getByText("Начните с частей системы")).toBeVisible();
  await page.getByRole("button", { name: "Создать архитектуру", exact: true }).click();
  await expect(page.getByLabel("Название архитектуры")).toHaveValue("Новая архитектура");
  await expect(page.getByRole("button", { name: "Выбрать папку", exact: true })).toHaveCount(0);
  await page.getByLabel("Название архитектуры").fill("Архитектура платежей");

  await page.getByRole("button", { name: "Инструменты схемы" }).click();
  const palette = page.getByLabel("Части схемы");
  await palette.getByRole("button", { name: "Часть", exact: true }).click();
  expect(pageErrors, consoleErrors.join("\n")).toEqual([]);
  await palette.getByRole("button", { name: "Часть", exact: true }).click();
  await palette.getByRole("button", { name: "Часть", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  const service = page.locator(".react-flow__node").filter({ hasText: "Часть 1" });
  await service.click();
  await page.getByLabel("Название", { exact: true }).fill("Payment Service");
  await page.getByLabel("Зачем", { exact: true }).fill("Обрабатывает платежи клиентов");

  const serviceNode = page.locator(".react-flow__node").filter({ hasText: "Payment Service" });
  const apiNode = page.locator(".react-flow__node").filter({ hasText: "Часть 2" });
  const output = await serviceNode.locator(".react-flow__handle-right").boundingBox();
  const input = await apiNode.locator(".react-flow__handle-left").boundingBox();
  expect(output && input).toBeTruthy();
  await page.mouse.move(output!.x + output!.width / 2, output!.y + output!.height / 2);
  await page.mouse.down();
  await page.mouse.move(input!.x + input!.width / 2, input!.y + input!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "Поведение", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.getByRole("button", { name: "Структура", exact: true }).click();
  await page.locator(".react-flow__edge").click();
  await page.getByLabel("Подпись", { exact: true }).fill("принимает запросы");
  await page.getByLabel("Название архитектуры").fill("");
  await page.getByRole("button", { name: "К схемам", exact: true }).click();
  await expect(page.getByLabel("Редактор архитектуры").getByRole("alert")).toContainText("Введите название схемы.");
  await expect(page.getByLabel("Название архитектуры")).toBeVisible();
  await page.getByLabel("Название архитектуры").fill("Архитектура платежей");
  // Leaving during the debounce must persist the latest edit before listing diagrams.
  await page.getByRole("button", { name: "К схемам", exact: true }).click();
  await expect(page.getByText("Архитектура платежей")).toBeVisible();
  await page.getByRole("button", { name: "Открыть схему «Архитектура платежей»" }).click();
  await expect(page.getByLabel("Название архитектуры")).toHaveValue("Архитектура платежей");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge-text")).toContainText("принимает запросы");
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = page.getByLabel("Редактор архитектуры");
  await expect.poll(() => editor.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);


  const diagrams = await (await request.get(`${base}/development/architect/diagrams`, { headers })).json();
  const saved = diagrams.find((row: { name: string }) => row.name === "Архитектура платежей");
  expect(saved?.nodeCount).toBe(3);
  const full = await (await request.get(`${base}/development/architect/diagrams/${saved.id}`, { headers })).json();
  expect(full).not.toHaveProperty("localFolder");
  expect(full.nodes.every((node: { kind: string }) => node.kind === "part")).toBe(true);
  expect(full.nodes.find((node: { title: string }) => node.title === "Payment Service").purpose).toBe("Обрабатывает платежи клиентов");
  expect(full.edges[0].label).toBe("принимает запросы");

  await page.reload();
  await expect(page.getByRole("button", { name: "Открыть схему «Архитектура платежей»" })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.getByRole("button", { name: "Открыть схему «Архитектура платежей»" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Инструменты схемы" }).click();
  const partButton = await page.getByRole("button", { name: "Часть", exact: true }).boundingBox();
  expect(partButton).toBeTruthy();
  expect(partButton!.x).toBeGreaterThanOrEqual(0);
  expect(partButton!.x + partButton!.width).toBeLessThanOrEqual(390);
  expect(pageErrors).toEqual([]);
});

test("architect: diagram API validates node types, revisions and workspace isolation", async ({ request }) => {
  const account = await register(request, "orion-dev");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}/development/architect/diagrams`;
  const created = await request.post(base, { headers, data: { name: "Изолированная архитектура" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const node = { id: "service-1", kind: "part", title: "Сервис", purpose: "Принимает запросы", x: 40, y: 80, parentId: null, binding: { path: "src/main.ts" } };
  const graph = { nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const updated = await request.put(`${base}/${id}`, { headers, data: { name: "Изолированная архитектура", description: "", graph, expectedRevision: 1 } });
  expect(updated.status()).toBe(200);
  const savedDiagram = await updated.json();
  expect(savedDiagram.revision).toBe(2);
  expect(savedDiagram.nodes[0].binding).toEqual({ path: "src/main.ts" });
  const mismatch = await request.put(`${base}/${id}`, { headers, data: { name: "Чужой путь", description: "", graph: { ...graph, nodes: [{ ...node, binding: { path: "../secret.ts" } }] }, expectedRevision: 2 } });
  expect(mismatch.status()).toBe(400);
  const stale = await request.put(`${base}/${id}`, { headers, data: { name: "Старая запись", description: "", graph, expectedRevision: 1 } });
  expect(stale.status()).toBe(409);
  const other = await register(request, "orion-dev");
  const foreign = await request.get(`${apiUrl()}/workspaces/${other.workspaceId}/development/architect/diagrams/${id}`, { headers: { Authorization: `Bearer ${other.accessToken}` } });
  expect(foreign.status()).toBe(404);
  expect((await request.delete(`${base}/${id}`, { headers })).status()).toBe(204);
});


test("architect: open implementation from a component and return to its behavior", async ({ page, request }, testInfo) => {
  const account = await register(request, "orion-dev");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}/development`;
  const scratch = join(process.cwd(), "tmp");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "architect-code-"));

  try {
    const repoResponse = await request.post(`${base}/git/repositories/init`, {
      headers, data: { name: "Тестовая система", path: directory }
    });
    expect(repoResponse.status()).toBe(201);
    const { id: repositoryId } = await repoResponse.json();
    await mkdir(join(directory, "src"));
    await writeFile(join(directory, "src", "refund.ts"), "export const refund = () => true;");

    const created = await request.post(`${base}/architect/diagrams`, { headers, data: { name: "Возврат платежа" } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const saved = await request.put(`${base}/architect/diagrams/${id}`, { headers, data: {
      name: "Возврат платежа", description: "", expectedRevision: 1,
      graph: {
        nodes: [
          { id: "api", kind: "part", title: "API", purpose: "", x: 0, y: 0, parentId: null, binding: { repositoryId, path: "src/refund.ts" } },
          { id: "provider", kind: "part", title: "Провайдер", purpose: "", x: 300, y: 20, parentId: null, binding: null }
        ],
        edges: [{ id: "call", source: "api", target: "provider", sourceHandle: null, targetHandle: null, kind: "launches", label: "Запрос возврата" }],
        viewport: null
      }
    } });
    expect(saved.status()).toBe(200);

    await signIn(page, account);
    await page.goto(`/panel/orion-dev?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Открыть схему «Возврат платежа»" }).click();
    const editor = page.getByLabel("Редактор архитектуры");
    await expect(editor.getByLabel("Части схемы")).toBeHidden();
    await expect(editor.getByLabel("Карточка части")).toBeHidden();
    await page.getByRole("button", { name: "Режим фокуса" }).click();
    await expect(page.getByRole("button", { name: "Выйти из фокуса" })).toBeVisible();
    await expect.poll(async () => (await editor.boundingBox())?.width ?? 0).toBeGreaterThan(1100);
    await page.getByRole("button", { name: "Выйти из фокуса" }).click();
    await page.getByRole("button", { name: "Поведение", exact: true }).click();
    await expect(page.locator(".react-flow__edge-text")).toContainText("Запрос возврата");
    await page.locator(".react-flow__node").filter({ hasText: "API" }).click();
    await page.getByRole("button", { name: "Показать на карте кода" }).click();
    await expect(page.getByLabel("Сведения об элементе")).toContainText("src/refund.ts");
    await page.getByRole("button", { name: "Вернуться к схеме" }).click();
    await expect(page.getByRole("button", { name: "Поведение", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Карточка части").getByRole("textbox", { name: "Название", exact: true })).toHaveValue("API");
    await page.screenshot({ path: testInfo.outputPath("architect-behavior.png") });
  } finally {
    await page.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
  }
});
