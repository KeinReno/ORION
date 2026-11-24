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

test("calendar view survives a reload and falls back safely on a bad value", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await register(request, "view-state-calendar");
  await signIn(page, account); await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  const calendar = page.getByRole("group", { name: "Календарь", exact: true });
  await expect(calendar.getByRole("tab", { name: "Месяц", exact: true })).toHaveAttribute("aria-selected", "true");
  await calendar.getByRole("tab", { name: "Неделя", exact: true }).click();
  await page.waitForTimeout(700);
  await page.reload();
  await expect(calendar.getByRole("tab", { name: "Неделя", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => { for (const key of Object.keys(window.localStorage)) if (key.startsWith("orion.viewState:")) window.localStorage.setItem(key, JSON.stringify({ calendar: { v: 1, state: { view: "year" } } })); });
  await page.reload();
  await expect(calendar.getByRole("tab", { name: "Месяц", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("documents folder and projects layout survive a reload; a removed folder explains itself", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await register(request, "view-state-docs");
  await disableAllPlugins(request, account);
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}/documents`;
  const folder = await (await request.post(base, { headers, data: { name: "Восстанавливаемая папка" } })).json();
  const uploaded = await request.post(`${base}/upload`, { headers, multipart: { parentId: folder.id, files: { name: "Внутри.txt", mimeType: "text/plain", buffer: Buffer.from("текст") } } });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
  await signIn(page, account); await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);

  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await page.getByRole("tab", { name: "Карточки", exact: true }).click();
  await page.getByRole("tab", { name: "Архив", exact: true }).click();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await page.getByText(folder.name, { exact: true }).first().click();
  await expect(page.getByText("Внутри.txt", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(700);

  await page.reload();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await expect(page.getByText("Внутри.txt", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Карточки", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Архив", exact: true })).toHaveAttribute("aria-selected", "true");

  expect((await request.delete(`${base}/${folder.id}`, { headers })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("Прежнее место недоступно", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await expect(page.getByText("Внутри.txt", { exact: true })).toHaveCount(0);
  await expect(page.getByText(folder.name, { exact: true })).toHaveCount(0);
});

test("a saved project filter is not restored while Projects is off; records and links stay", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await register(request, "view-state-modules");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`${base}/${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const project = await post("projects", { name: "Фильтруемый проект" });
  const inProject = await post("notes", { title: "Заметка проекта", body: "", tags: [], projectId: project.id });
  const loose = await post("notes", { title: "Заметка без проекта", body: "", tags: [] });
  const taskIn = await post("tasks", { title: "Задача проекта", status: "todo", projectId: project.id });
  const taskLoose = await post("tasks", { title: "Задача без проекта", status: "todo" });
  await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
  await signIn(page, account); await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);

  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await page.getByRole("combobox", { name: "Фильтр по проекту", exact: true }).click();
  await page.getByRole("option", { name: project.name, exact: true }).click();
  const noteRow = (title: string) => page.getByRole("checkbox", { name: `Выбрать заметку «${title}» для стопки`, exact: true });
  await expect(noteRow(loose.title)).toHaveCount(0);
  await expect(noteRow(inProject.title)).toBeVisible();
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.getByRole("button", { name: project.name, exact: true }).first().click();
  await expect(page.getByText(taskLoose.title, { exact: true })).toHaveCount(0);
  await page.waitForTimeout(700);

  const off = await request.patch(`${base}/modules/projects`, { headers, data: { enabled: false, confirm: true } });
  expect(off.ok(), await off.text()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await expect(noteRow(loose.title)).toBeVisible();
  await expect(noteRow(inProject.title)).toBeVisible();
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await expect(page.getByText(taskLoose.title, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(taskIn.title, { exact: true }).first()).toBeVisible();

  // Nothing was deleted: notes, tasks and the project survive, and the notes still point at the project.
  const notes = (await (await request.get(`${base}/notes`, { headers })).json()) as { id: string; projectId: string | null }[];
  expect(notes.find(n => n.id === inProject.id)?.projectId).toBe(project.id);
  expect(notes.some(n => n.id === loose.id)).toBe(true);
  const tasks = (await (await request.get(`${base}/tasks`, { headers })).json()) as { id: string; projectId: string | null }[];
  expect(tasks.find(t => t.id === taskIn.id)?.projectId).toBe(project.id);
});
