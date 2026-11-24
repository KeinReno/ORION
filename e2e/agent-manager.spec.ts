import { expect, test, type Page } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

/**
 * TZ-03 — Agent Manager through the real shell: the agent (plain HTTP with a token) proposes a change, the human sees the
 * before/after in Settings → ИИ и агенты, approves it, finds the call in the journal, undoes a creation, and revokes all tokens.
 */

async function openAgents(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`/dashboard?workspaceId=${workspaceId}`);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("navigation", { name: "Разделы настроек" });
  await settings.getByRole("button", { name: /^Пространство «/ }).click();
  await settings.getByRole("button", { name: "ИИ и агенты", exact: true }).click();
}

test("помощник предлагает правку: превью → подтверждение → журнал → отмена создания → отозвать все", async ({ page, request }) => {
  const account = await register(request, "agentmgr");
  const human = { Authorization: `Bearer ${account.accessToken}` };
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;

  const issued = await request.post(`${ws}/agent-tokens`, {
    headers: human,
    data: { name: "Claude E2E", scopes: ["tasks:read", "tasks:write", "notes:read", "notes:write"], expiresInDays: 30 }
  });
  expect(issued.status(), await issued.text()).toBe(201);
  const secret = ((await issued.json()) as { secret: string }).secret;
  const agent = { Authorization: `Bearer ${secret}` };

  // The agent creates at once, but a change to an existing object is only a proposal.
  const task = (await (await request.post(`${apiUrl()}/ai/v1/tasks`, { headers: agent, data: { title: "Исходная задача" } })).json()) as { id: string };
  const note = (await (await request.post(`${apiUrl()}/ai/v1/notes`, { headers: agent, data: { title: "Заметка агента" } })).json()) as { id: string };
  const patch = await request.patch(`${apiUrl()}/ai/v1/tasks/${task.id}`, { headers: agent, data: { title: "Новое название", status: "done" } });
  expect(patch.status()).toBe(202);

  await signIn(page, account);
  await openAgents(page, account.workspaceId);

  // The token list shows the mode; the proposal shows what changes.
  await expect(page.getByLabel("Режим: Claude E2E")).toHaveText("Помощник");
  const proposals = page.getByRole("region", { name: "Запросы агентов" });
  await expect(proposals.getByText(/изменить задачу «Исходная задача»/i)).toBeVisible();
  await expect(proposals.getByRole("cell", { name: "Исходная задача" })).toBeVisible();
  await expect(proposals.getByRole("cell", { name: "Новое название" })).toBeVisible();
  await proposals.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(proposals).toHaveCount(0);

  const tasks = (await (await request.get(`${ws}/tasks`, { headers: human })).json()) as { id: string; title: string; status: string }[];
  expect(tasks.find((t) => t.id === task.id)).toMatchObject({ title: "Новое название", status: "done" });

  // The journal says what was done, and filters narrow it.
  await page.getByRole("tab", { name: "Журнал", exact: true }).click();
  await expect(page.getByText("Создал заметку «Заметка агента»")).toBeVisible();
  await page.getByLabel("Результат").click();
  await page.getByRole("option", { name: "Предложено", exact: true }).click();
  await expect(page.getByText("Создал заметку «Заметка агента»")).toHaveCount(0);
  await expect(page.getByText("Предложил: изменить задачу «Исходная задача»", { exact: true })).toBeVisible();
  await page.getByLabel("Результат").click();
  await page.getByRole("option", { name: "Любой результат", exact: true }).click();

  // Undo a creation: the note lands in the trash, it is not hard-deleted.
  await page.getByRole("button", { name: "Отменить создание" }).first().click();
  await expect(page.getByText("(отменено)")).toBeVisible();
  const trash = (await (await request.get(`${ws}/notes?view=trash`, { headers: human })).json()) as { id: string }[];
  expect(trash.map((n) => n.id)).toContain(note.id);

  // Panic button.
  await page.getByRole("tab", { name: "Подключения", exact: true }).click();
  await page.getByRole("button", { name: "Отключить все" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Отключить", exact: true }).click();
  await page.getByRole("button", { name: /^Отключённые и истёкшие/ }).click();
  await expect(page.getByText("отключено", { exact: true })).toBeVisible();
  expect((await request.get(`${apiUrl()}/ai/v1/tasks`, { headers: agent })).status()).toBe(401);
});
