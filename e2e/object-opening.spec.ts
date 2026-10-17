import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

for (const pluginsOff of [false, true]) {
  test(`linked object opening preserves editor and ownership (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const account = await register(request, "object-opening");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
    const post = async (path: string, data: unknown) => {
      const response = await request.post(`${base}/${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true); return response.json();
    };
    const task = await post("tasks", { title: "Задача для связанных материалов", status: "todo" });
    const note = await post("notes", { title: "Связанный материал", body: "Исходный текст", tags: [] });
    const second = await post("notes", { title: "Второй материал", body: "Другой текст", tags: [] });
    for (const target of [note, second]) await post("links", { sourceType: "task", sourceId: task.id, targetType: "note", targetId: target.id, kind: "related_to", label: null });
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account); await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    await page.locator(`[id="task-${task.id}"]`).click();
    const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
    const taskTitle = detail.getByRole("textbox", { name: "Название задачи", exact: true });
    await page.route(`**/tasks/${task.id}`, async route => {
      if (route.request().method() === "PATCH") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Тестовый сбой" }) });
      else await route.continue();
    });
    await taskTitle.fill("Несохранённая задача");
    await expect(detail).toContainText("Не удалось сохранить — оставьте задачу открытой");
    await detail.getByRole("tab", { name: "Связи", exact: true }).click();
    await detail.getByRole("button", { name: "Открытие: Связанный материал", exact: true }).click();
    // Same menu is reachable and operable from the keyboard.
    await page.getByRole("menuitem", { name: "Открыть рядом", exact: true }).focus();
    await page.keyboard.press("Enter");
    const noteTitle = page.getByRole("textbox", { name: "Название заметки", exact: true });
    await expect(noteTitle).toHaveValue(note.title);
    await expect(taskTitle).toBeVisible();
    await expect(taskTitle).toHaveValue("Несохранённая задача");
    const before = await taskTitle.boundingBox(); const after = await noteTitle.boundingBox();
    expect(before && after && after.x > before.x).toBeTruthy();
    await detail.getByRole("button", { name: "Открытие: Связанный материал", exact: true }).click();
    await page.getByRole("menuitem", { name: "Открыть в новой вкладке", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Название заметки", exact: true })).toHaveCount(1);
    await noteTitle.fill("Материал после редактирования");
    await expect.poll(async () => (await (await request.get(`${base}/notes/${note.id}`, { headers })).json()).title).toBe("Материал после редактирования");
    await detail.getByRole("button", { name: "Открытие: Второй материал", exact: true }).click();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("menuitem", { name: "Открыть в отдельном окне", exact: true }).click();
    const popup = await popupPromise;
    await expect(popup.getByRole("textbox", { name: "Название заметки", exact: true })).toHaveValue(second.title);
    expect(new URL(popup.url()).searchParams.get("workspaceId")).toBe(account.workspaceId);
    expect(new URL(popup.url()).searchParams.get("instance")).toBe(second.id);
    await popup.close();
    // Narrow mode would close the source panel: guard must retain its failed draft.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    await detail.getByRole("button", { name: "Открытие: Второй материал", exact: true }).click();
    await page.getByRole("menuitem", { name: "Открыть рядом", exact: true }).click();
    await expect(page.getByText("Сначала сохраните изменения", { exact: true })).toBeVisible();
    await expect(taskTitle).toHaveValue("Несохранённая задача");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.unroute(`**/tasks/${task.id}`);
    await detail.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(detail).toContainText("Всё сохранено");
    await page.screenshot({ path: `tmp/redesign/object-opening-${pluginsOff ? "plugins-off" : "default-full"}.png` });
    expect((await (await request.get(`${base}/tasks`, { headers })).json()).filter((item: { id: string }) => item.id === task.id)).toHaveLength(1);
    expect((await (await request.get(`${base}/notes`, { headers })).json()).filter((item: { id: string }) => item.id === note.id)).toHaveLength(1);
  });
}
