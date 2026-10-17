import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce", actionTimeout: 15_000 });
for (const pluginsOff of [false, true]) {
  test(`search and project materials share explicit object opening (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const account = await register(request, "object-entries");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
    const post = async (path: string, data: unknown) => {
      const response = await request.post(`${base}/${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true); return response.json();
    };
    const project = await post("projects", { name: "Проект общих команд" });
    const task = await post("tasks", { title: "Задача для поиска", projectId: project.id, status: "todo" });
    const note = await post("notes", { title: "Материал для поиска", projectId: project.id, body: "Текст материала", tags: [] });
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account); await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    const palette = page.getByRole("dialog", { name: "Поиск и команды", exact: true });
    // Hold the server response until the local record's menu is open, then
    // change its label to prove the rendered server result kept that menu.
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>(resolve => { releaseSearch = resolve; });
    const searchPattern = `**/workspaces/${account.workspaceId}/search?**`;
    await page.route(searchPattern, async route => {
      await searchGate;
      const response = await route.fetch();
      const hits = await response.json();
      await route.fulfill({ response, json: hits.map((hit: { id: string; title: string }) => hit.id === task.id ? { ...hit, title: `${hit.title} · сервер` } : hit) });
    });
    await page.getByRole("button", { name: "Поиск и команды", exact: true }).click();
    await palette.getByRole("textbox", { name: "Поиск команд и записей", exact: true }).fill(task.title);
    await palette.getByRole("button", { name: `Открытие: ${task.title}`, exact: true }).click();
    releaseSearch();
    await expect(palette.getByRole("button", { name: `Открытие: ${task.title} · сервер`, exact: true })).toBeVisible();
    await palette.getByRole("menuitem", { name: "Открыть в новой вкладке", exact: true }).click();
    await page.unroute(searchPattern);
    await expect(palette).not.toBeVisible();
    const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
    const taskTitle = detail.getByRole("textbox", { name: "Название задачи", exact: true });
    await expect(taskTitle).toHaveValue(task.title);
    await page.route(`**/tasks/${task.id}`, async route => {
      if (route.request().method() === "PATCH") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Тестовый сбой" }) });
      else await route.continue();
    });
    await taskTitle.fill("Черновик из поиска");
    await expect(detail).toContainText("Не удалось сохранить — оставьте задачу открытой");
    await page.keyboard.press("Control+k");
    await palette.getByRole("textbox", { name: "Поиск команд и записей", exact: true }).fill(note.title);
    await palette.getByRole("button", { name: `Открытие: ${note.title}`, exact: true }).click();
    await palette.getByRole("menuitem", { name: "Открыть рядом", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(palette).not.toBeVisible();
    const noteTitle = page.getByRole("textbox", { name: "Название заметки", exact: true });
    await expect(noteTitle).toHaveValue(note.title);
    await expect(taskTitle).toBeVisible();
    await expect(taskTitle).toHaveValue("Черновик из поиска");
    const taskBox = await taskTitle.boundingBox(); const noteBox = await noteTitle.boundingBox();
    expect(taskBox && noteBox && noteBox.x > taskBox.x).toBeTruthy();
    // Existing project view in the space tree uses the very same materials component.
    const context = page.getByRole("complementary", { name: "Контекст пространства", exact: true });
    await context.getByRole("button", { name: `Виды проекта ${project.name}`, exact: true }).click();
    await context.getByRole("button", { name: "Материалы", exact: true }).click();
    await page.getByRole("button", { name: `Открытие: ${note.title}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Открыть рядом", exact: true }).click();
    await expect(noteTitle).toHaveCount(1);
    await context.getByRole("button", { name: "Материалы", exact: true }).click();
    await page.getByRole("tab", { name: "Колонки", exact: true }).click();
    await page.getByRole("button", { name: `Открытие: ${note.title}`, exact: true }).click();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("menuitem", { name: "Открыть в отдельном окне", exact: true }).click();
    const popup = await popupPromise;
    await expect(popup.getByRole("textbox", { name: "Название заметки", exact: true })).toHaveValue(note.title);
    expect(new URL(popup.url()).searchParams.get("workspaceId")).toBe(account.workspaceId);
    expect(new URL(popup.url()).searchParams.get("instance")).toBe(note.id);
    await popup.close();
    await expect(taskTitle).toHaveValue("Черновик из поиска");
    await page.unroute(`**/tasks/${task.id}`);
    await detail.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(detail).toContainText("Всё сохранено");
    expect(await (await request.get(`${base}/notes`, { headers })).json()).toHaveLength(1);
    const savedTasks = await (await request.get(`${base}/tasks`, { headers })).json();
    expect(savedTasks).toHaveLength(1);
    expect(savedTasks[0].title).toBe("Черновик из поиска");
    await page.screenshot({ path: `tmp/redesign/object-entries-${pluginsOff ? "plugins-off" : "default-full"}.png` });
  });
}
