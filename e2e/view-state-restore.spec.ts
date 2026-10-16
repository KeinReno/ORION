import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

for (const pluginsOff of [false, true]) {
  test(`open task and note are restored after reload; vanished ones explain safely (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const account = await register(request, "view-state");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
    const post = async (path: string, data: unknown) => {
      const response = await request.post(`${base}/${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true); return response.json();
    };
    const task = await post("tasks", { title: "Задача для восстановления", status: "todo", priority: "high" });
    await post("tasks", { title: "Другая задача", status: "todo" });
    const note = await post("notes", { title: "Заметка для восстановления", body: "Текст не сохраняется в раскладке", tags: [] });
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account); await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);

    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    await page.locator(`[id="task-${task.id}"]`).click();
    const taskTitle = page.getByRole("region", { name: "Детали задачи", exact: true }).getByRole("textbox", { name: "Название задачи", exact: true });
    await expect(taskTitle).toHaveValue(task.title);
    await page.getByRole("button", { name: "Заметки", exact: true }).click();
    await page.getByText(note.title, { exact: true }).first().click();
    const noteTitle = page.getByRole("textbox", { name: "Название заметки", exact: true });
    await expect(noteTitle).toHaveValue(note.title);

    // What is stored: ids and filters only — no titles, no body text.
    await page.waitForTimeout(700);
    const stored = await page.evaluate(() => Object.entries(window.localStorage).filter(([k]) => k.startsWith("orion.viewState:")).map(([, v]) => v).join("\n"));
    expect(stored).toContain(task.id); expect(stored).toContain(note.id);
    expect(stored).not.toContain(task.title); expect(stored).not.toContain(note.title); expect(stored).not.toContain("Текст не сохраняется");

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Название заметки", exact: true })).toHaveValue(note.title);
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    await expect(page.getByRole("region", { name: "Детали задачи", exact: true }).getByRole("textbox", { name: "Название задачи", exact: true })).toHaveValue(task.title);
    await page.screenshot({ path: `tmp/redesign/view-state-restore-${pluginsOff ? "plugins-off" : "default-full"}.png` });

    // The records disappear while the app is closed: no stale title, a plain explanation.
    for (const [path, id] of [["tasks", task.id], ["notes", note.id]] as const) {
      expect((await request.delete(`${base}/${path}/${id}`, { headers })).ok()).toBe(true);
    }
    await page.reload();
    await expect(page.getByText("Прежняя заметка недоступна", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    await expect(page.getByText("Прежняя задача недоступна", { exact: true })).toBeVisible();
    await expect(page.getByText(task.title)).toHaveCount(0);
    await expect(page.getByText(note.title)).toHaveCount(0);

    // A corrupt stored value is ignored instead of breaking the panels.
    await page.evaluate(() => { for (const key of Object.keys(window.localStorage)) if (key.startsWith("orion.viewState:")) window.localStorage.setItem(key, "{broken"); });
    await page.reload();
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    await expect(page.getByText("Другая задача", { exact: true }).first()).toBeVisible();
  });
}
