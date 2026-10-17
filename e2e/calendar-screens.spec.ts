import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Screens of the Calendar module on synthetic data. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/calendar";
const hour = 3_600_000;
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

test("calendar screens: month, week, agenda, narrow", async ({ page, request }) => {
  test.setTimeout(150_000);
  const account = await register(request, "calendar-screens");
  const seeded = await seedProjects(request, account);
  const post = async (path: string, data: unknown) => (await request.post(`${seeded.base}/${path}`, { headers: seeded.headers, data })).json();
  const now = Date.now();
  for (const [i, title] of ["Планёрка команды", "Созвон с клиентом по макетам", "Обед", "Тренировка", "Встреча по проекту запуска сайта студии"].entries()) {
    await post("events", { title, startAt: new Date(now + (i * 20 + 2) * hour).toISOString(), endAt: new Date(now + (i * 20 + 3) * hour).toISOString(), allDay: false, reminders: [] });
  }
  await post("events", { title: "Отпуск на неделю", startAt: new Date(now + 3 * 24 * hour).toISOString(), endAt: new Date(now + 6 * 24 * hour).toISOString(), allDay: true, reminders: [] });
  await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  const calendar = page.getByRole("group", { name: "Календарь", exact: true });
  await expect(calendar.getByRole("tab", { name: "Месяц", exact: true })).toBeVisible();
  await shot(page, "month-1600");
  await calendar.getByRole("tab", { name: "Неделя", exact: true }).click();
  await shot(page, "week-1600");
  await calendar.getByRole("tab", { name: "Список", exact: true }).click();
  await shot(page, "agenda-1600");
  await calendar.getByRole("tab", { name: "Месяц", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: "Календарь", exact: true }).click();
  await expect(page.getByRole("group", { name: "Календарь", exact: true })).toBeVisible();
  await shot(page, "month-390");
  // Sources stay reachable behind the disclosure and still toggle.
  const disclosure = page.locator("summary").filter({ hasText: "Источники" });
  if (await disclosure.count()) {
    await disclosure.click();
    const tasksChip = page.getByRole("button", { name: "Задачи", exact: true }).filter({ has: page.locator("span[aria-hidden]") }).first();
    await expect(tasksChip).toBeVisible();
    await disclosure.click();
  }
  await page.getByRole("group", { name: "Календарь", exact: true }).getByRole("tab", { name: "Список", exact: true }).click();
  await shot(page, "agenda-390");
});

test("calendar screens: empty workspace", async ({ page, request }) => {
  const account = await register(request, "calendar-empty");
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page.waitForTimeout(800);
  await shot(page, "empty-1600");
});
