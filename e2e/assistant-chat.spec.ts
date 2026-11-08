import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

/**
 * The built-in assistant against a fake model on 127.0.0.1:4555 (ORION_ANTHROPIC_URL in playwright.config.ts): it sees the
 * task on screen as «эта задача», proposes a rename, the user applies it right in the chat, and the conversation is still
 * there after a reload. Ctrl+K hands a question to the chat.
 */
test.use({ reducedMotion: "reduce" });

let fake: Server;
const systems: string[] = [];

test.beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as { system: string; messages: Array<{ role: string; content: unknown }> };
      systems.push(body.system);
      const last = body.messages[body.messages.length - 1]!;
      const toolDone = Array.isArray(last.content) && (last.content as Array<{ type: string }>).some((block) => block.type === "tool_result");
      const taskId = /\(id ([^)]+)\)/.exec(body.system)?.[1];
      const reply =
        !toolDone && taskId && JSON.stringify(last.content).includes("переименуй")
          ? { content: [{ type: "tool_use", id: "tu1", name: "orion_update_task", input: { taskId, title: "Купить корм и наполнитель" } }], stop_reason: "tool_use" }
          : { content: [{ type: "text", text: toolDone ? "Предложил **переименовать** задачу — подтвердите ниже." : "Здравствуйте! Чем помочь?" }], stop_reason: "end_turn" };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...reply, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(4555, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

test("the assistant sees the open task, proposes a rename applied in the chat, and keeps the conversation", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await register(request, "assistant-chat");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  expect((await request.put(`${apiUrl()}/assistant/key`, { headers, data: { apiKey: "sk-ant-e2e-fake-key-0123456789", model: "claude-test" } })).status()).toBe(200);
  const task = (await (await request.post(`${base}/tasks`, { headers, data: { title: "Купить корм коту", status: "todo" } })).json()) as { id: string };

  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Задачи", exact: true }).first().click();
  await page.getByText("Купить корм коту", { exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Детали задачи", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ассистент", exact: true }).first().click();
  const composer = page.getByRole("textbox", { name: "Сообщение ассистенту", exact: true });
  // Who answers: the key here; Codex / Cursor are listed and say what is missing when not installed.
  await expect(page.getByRole("button", { name: "Кто отвечает", exact: true })).toContainText("Свой ключ Anthropic · claude-test");
  await composer.click();
  await expect(page.getByText(/Учитывать открытое: .*Купить корм коту/)).toBeVisible();
  await composer.fill("переименуй эту задачу");
  await composer.press("Enter");

  const chat = page.getByRole("region", { name: "Беседа", exact: true });
  await expect(chat.getByText("переименовать", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(systems.some((system) => system.includes(`(id ${task.id})`))).toBe(true);
  const decision = chat.getByRole("group", { name: "Подтверждение: Изменить задачу «Купить корм коту»" });
  await decision.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(chat.getByText(/Изменить задачу «Купить корм коту»: применено/)).toBeVisible();
  const tasks = (await (await request.get(`${base}/tasks`, { headers })).json()) as Array<{ id: string; title: string }>;
  expect(tasks.find((item) => item.id === task.id)?.title).toBe("Купить корм и наполнитель");

  // The conversation is saved: listed, and still there after a reload.
  const list = page.getByRole("complementary", { name: "Беседы", exact: true });
  await expect(list.getByRole("button", { name: /^переименуй эту задачу/ })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Ассистент", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Беседа", exact: true }).getByText("переименуй эту задачу", { exact: true })).toBeVisible();
  await page.screenshot({ path: "tmp/redesign/assistant-chat.png" });

  // A file without a word: saved in the assistant's inbox folder, shown on the message, described to the model.
  await page.getByRole("button", { name: "Новая беседа", exact: true }).click();
  await page.getByLabel("Файлы для ассистента").setInputFiles({ name: "счёт-интернет.txt", mimeType: "text/plain", buffer: Buffer.from("Счёт за интернет, октябрь: 650 ₽") });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы", exact: true })).toContainText("счёт-интернет.txt");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const fileChat = page.getByRole("region", { name: "Беседа", exact: true });
  await expect(fileChat.getByRole("button", { name: /счёт-интернет\.txt/ })).toBeVisible({ timeout: 20_000 });
  expect(systems.length).toBeGreaterThan(0);
  const documents = (await (await request.get(`${base}/documents`, { headers })).json()) as Array<{ id: string; name: string; parentId: string | null }>;
  const inbox = documents.find((item) => item.name === "Ассистент — входящие" && item.parentId === null);
  expect(documents.some((item) => item.name === "счёт-интернет.txt" && item.parentId === inbox?.id)).toBe(true);

  // Ctrl+K: a question goes to the chat composer of a new conversation.
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Поиск и команды", exact: true });
  await palette.getByRole("textbox", { name: "Поиск команд и записей", exact: true }).fill("что у меня на неделе");
  await palette.getByRole("button", { name: /Спросить ассистента: «что у меня на неделе»/ }).click();
  await expect(page.getByRole("textbox", { name: "Сообщение ассистенту", exact: true })).toHaveValue("что у меня на неделе");
});
