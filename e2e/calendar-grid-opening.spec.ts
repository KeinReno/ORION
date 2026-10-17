import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";

test.use({ reducedMotion: "reduce", actionTimeout: 15_000 });

/** An hour that stays inside today's Moscow calendar day (the browser runs in Europe/Moscow). */
function sameDayTimes(): { first: string; second: string } {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Moscow" }).format(new Date()));
  const shift = hour >= 21 ? -(hour - 8) : hour <= 1 ? 3 : 0;
  const base = Date.now() + shift * 3_600_000;
  return { first: new Date(base + 3_600_000).toISOString(), second: new Date(base + 2 * 3_600_000).toISOString() };
}

for (const pluginsOff of [false, true]) {
  test(`calendar grids open original objects from a context menu (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(150_000);
    const account = await register(request, "calendar-grid");
    if (pluginsOff) await disableAllPlugins(request, account);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
    const post = async (path: string, data: unknown) => {
      const response = await request.post(`${base}/${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true); return response.json();
    };
    const { first, second } = sameDayTimes();
    const task = await post("tasks", { title: "Сеточная задача", status: "todo", dueAt: first });
    const note = await post("notes", { title: "Сеточная заметка", body: "Исходный текст", eventAt: second, tags: [] });
    const event = await post("events", { title: "Сеточное событие", startAt: first, endAt: second, allDay: false, reminders: [] });
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account); await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Календарь", exact: true }).click();
    const calendar = page.getByRole("group", { name: "Календарь", exact: true });
    const taskTitle = page.getByRole("region", { name: "Детали задачи", exact: true }).getByRole("textbox", { name: "Название задачи", exact: true });
    const noteTitle = page.getByRole("textbox", { name: "Название заметки", exact: true });

    for (const [view, how] of [["Месяц", "mouse"], ["Неделя", "menu-key"], ["День", "shift-f10"]] as const) {
      await calendar.getByRole("tab", { name: view, exact: true }).click();
      const taskPill = calendar.getByRole("button", { name: new RegExp(task.title) }).first();
      await expect(taskPill).toBeVisible();
      if (how === "mouse") await taskPill.click({ button: "right" });
      else { await taskPill.focus(); await page.keyboard.press(how === "menu-key" ? "ContextMenu" : "Shift+F10"); }
      const menu = page.getByRole("menu", { name: `Открытие: ${task.title}`, exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem").first()).toBeFocused();
      // Escape closes it and returns focus to the item.
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(taskPill).toBeFocused();
      // Reopen and run "beside" from the keyboard.
      await page.keyboard.press(how === "shift-f10" ? "Shift+F10" : "ContextMenu");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(taskTitle).toHaveValue(task.title);
      await expect(calendar.getByRole("tab", { name: view, exact: true })).toHaveAttribute("aria-selected", "true");

      const notePill = calendar.getByRole("button", { name: new RegExp(note.title) }).first();
      await notePill.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Открыть в новой вкладке", exact: true }).click();
      await expect(noteTitle).toHaveValue(note.title);
      await page.getByRole("button", { name: "Календарь", exact: true }).click();
      await expect(calendar.getByRole("tab", { name: view, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".dv-tab").filter({ hasText: note.title })).toHaveCount(1);
      await expect(page.locator(".dv-tab").filter({ hasText: task.title })).toHaveCount(1);

      // Native events keep their own behavior: no object menu, normal click still opens the event sheet.
      await calendar.getByRole("button", { name: new RegExp(event.title) }).first().click({ button: "right" });
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
    await page.screenshot({ path: `tmp/redesign/calendar-grid-opening-${pluginsOff ? "plugins-off" : "default-full"}.png` });
    for (const [path, id] of [["tasks", task.id], ["notes", note.id], ["events", event.id]] as const) {
      const rows = (await (await request.get(`${base}/${path}${path === "events" ? `?from=${encodeURIComponent(new Date(Date.parse(first) - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(second) + 86_400_000).toISOString())}` : ""}`, { headers })).json()) as { id: string; dueAt?: string; eventAt?: string; startAt?: string }[];
      expect(rows.filter(row => row.id === id)).toHaveLength(1);
    }
    const tasks = (await (await request.get(`${base}/tasks`, { headers })).json()) as { id: string; dueAt: string }[];
    expect(new Date(tasks.find(row => row.id === task.id)!.dueAt).getTime()).toBe(new Date(first).getTime());
  });
}
