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
  await page.waitForTimeout(800); // the view is saved with a short debounce
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: "Календарь", exact: true }).click();
  const narrow = page.getByRole("group", { name: "Календарь", exact: true });
  await expect(narrow).toBeVisible();
  const tab = (name: string) => narrow.getByRole("tab", { name, exact: true });

  // Sources: the disclosure is mandatory at 390 px and every toggle really filters the agenda.
  await tab("Список").click();
  await expect(tab("Список")).toHaveAttribute("aria-selected", "true");
  await expect(narrow.getByText("Вёрстка кабинета клиента")).toBeVisible();
  const sources = page.locator("details").filter({ has: page.locator("summary", { hasText: "Источники" }) });
  await sources.locator("summary").click();
  const tasksChip = sources.getByRole("button", { name: "Задачи", exact: true });
  await expect(tasksChip).toHaveAttribute("aria-pressed", "true");
  await tasksChip.click();
  await expect(tasksChip).toHaveAttribute("aria-pressed", "false");
  await expect(narrow.getByText("Вёрстка кабинета клиента")).toHaveCount(0);
  await expect(narrow.getByText("Планёрка команды")).toBeVisible(); // events are another source and stay
  await tasksChip.click();
  await expect(tasksChip).toHaveAttribute("aria-pressed", "true");
  await expect(narrow.getByText("Вёрстка кабинета клиента")).toBeVisible();
  await sources.locator("summary").click();
  await shot(page, "agenda-390");

  // The month shot shows the month: tab selected and the weekday header of the grid present.
  await tab("Месяц").click();
  await expect(tab("Месяц")).toHaveAttribute("aria-selected", "true");
  await expect(narrow.getByText("Октябрь 2026")).toBeVisible();
  await expect(narrow.getByText("Пн", { exact: true })).toBeVisible();
  await expect(narrow.getByText("Ближайшее")).toHaveCount(0);
  await shot(page, "month-390");
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
