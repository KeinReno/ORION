import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

for (const pluginsOff of [false, true]) {
  test(`history returns to the previous object without duplicates or lost input (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const account = await register(request, "nav-history");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
    const post = async (path: string, data: unknown) => {
      const response = await request.post(`${base}/${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true); return response.json();
    };
    const task = await post("tasks", { title: "Задача истории", status: "todo" });
    const note = await post("notes", { title: "Материал истории", body: "Текст", tags: [] });
    await post("links", { sourceType: "task", sourceId: task.id, targetType: "note", targetId: note.id, kind: "related_to", label: null });
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account); await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    const history = page.getByRole("group", { name: "История переходов", exact: true });
    const back = history.getByRole("button", { name: "Назад (Alt+←)", exact: true });
    const forward = history.getByRole("button", { name: "Вперёд (Alt+→)", exact: true });
    await expect(back).toBeDisabled(); await expect(forward).toBeDisabled();

    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    await page.locator(`[id="task-${task.id}"]`).click();
    const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
    const taskTitle = detail.getByRole("textbox", { name: "Название задачи", exact: true });
    await taskTitle.fill("Задача истории — правка");
    await expect(detail).toContainText("Всё сохранено");
    await detail.getByRole("tab", { name: "Связи", exact: true }).click();
    await detail.getByRole("button", { name: "Открытие: Материал истории", exact: true }).click();
    await page.getByRole("menuitem", { name: "Открыть в новой вкладке", exact: true }).click();
    const noteTitle = page.getByRole("textbox", { name: "Название заметки", exact: true });
    await expect(noteTitle).toHaveValue(note.title);
    await expect(back).toBeEnabled(); await expect(forward).toBeDisabled();

    // Back by button → the task board with the same selected task and text.
    await back.click();
    await expect(taskTitle).toBeVisible();
    await expect(taskTitle).toHaveValue("Задача истории — правка");
    await expect(forward).toBeEnabled();
    // Forward by keyboard → the same note, no second editor.
    await page.keyboard.press("Alt+ArrowRight");
    await expect(noteTitle).toHaveValue(note.title);
    await expect(page.getByRole("textbox", { name: "Название заметки", exact: true })).toHaveCount(1);
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(taskTitle).toHaveValue("Задача истории — правка");
    // A new visit drops the forward branch.
    await page.getByRole("button", { name: "Календарь", exact: true }).click();
    await expect(forward).toBeDisabled();
    await page.screenshot({ path: `tmp/redesign/navigation-history-${pluginsOff ? "plugins-off" : "default-full"}.png` });
    expect((await (await request.get(`${base}/tasks`, { headers })).json()).filter((item: { id: string }) => item.id === task.id)).toHaveLength(1);
    expect((await (await request.get(`${base}/notes`, { headers })).json()).filter((item: { id: string }) => item.id === note.id)).toHaveLength(1);
  });
}
