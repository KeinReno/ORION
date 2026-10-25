import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

for (const pluginsOff of [false, true]) {
  test(`completing a task in the UI stops its timer atomically (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    const account = await register(request, "task-time-bridge");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const workspaceUrl = `${apiUrl()}/workspaces/${account.workspaceId}`;
    const created = await request.post(`${workspaceUrl}/tasks`, { headers, data: { title: "Завершить проверку таймера" } });
    expect(created.ok()).toBe(true);
    const task = await created.json();
    const started = await request.post(`${workspaceUrl}/time/start`, { headers, data: { taskId: task.id } });
    expect(started.ok()).toBe(true);
    const entry = await started.json();
    await signIn(page, account);
    await page.goto(`/panel/tasks?workspaceId=${account.workspaceId}`);
    await expect(page.getByText(task.title, { exact: true })).toBeVisible();
    const responsePromise = page.waitForResponse(response => response.url() === `${workspaceUrl}/tasks/${task.id}` && response.request().method() === "PATCH");
    await page.getByRole("checkbox", { name: "Отметить выполненной", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    expect((await response.json()).status).toBe("done");
    // No sleep/polling the asynchronous outbox: already stopped at command commit.
    const running = await request.get(`${workspaceUrl}/time/running`, { headers });
    expect(running.ok()).toBe(true);
    // Nest returns an empty 200 body for null; ApiClient treats it as null too.
    const runningBody = await running.text();
    expect(runningBody ? JSON.parse(runningBody) : null).toBeNull();
    const entriesResponse = await request.get(`${workspaceUrl}/time`, { headers });
    expect(entriesResponse.ok()).toBe(true);
    const entries = await entriesResponse.json();
    const rows = Array.isArray(entries) ? entries : entries.items;
    expect(rows.find((row: { id: string }) => row.id === entry.id)).toMatchObject({ taskId: task.id, running: false });
    await page.goto(`/panel/time?workspaceId=${account.workspaceId}`);
    const title = page.locator("p", { hasText: task.title });
    await expect(title).toHaveText(task.title);
    await expect(title).toBeVisible();
  });
}
