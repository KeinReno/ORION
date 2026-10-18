import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Week and day grid on real overlaps, all-day, multi-day and overnight events. `SHOT_DIR` selects evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/calendar-week-day";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

// playwright.config.ts runs the browser in Europe/Moscow (UTC+3, no DST): seed wall times in that zone.
const MSK_OFFSET_H = 3;
interface Day { y: number; m: number; d: number }
function mskToday(): Day {
  const msk = new Date(Date.now() + MSK_OFFSET_H * 3_600_000);
  return { y: msk.getUTCFullYear(), m: msk.getUTCMonth(), d: msk.getUTCDate() };
}
function plus(day: Day, days: number): Day {
  const next = new Date(Date.UTC(day.y, day.m, day.d + days));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth(), d: next.getUTCDate() };
}
/** Monday = 0 … Sunday = 6. */
function weekday(day: Day): number {
  return (new Date(Date.UTC(day.y, day.m, day.d)).getUTCDay() + 6) % 7;
}
/** Moscow wall time on `day`. */
function at(day: Day, hours: number, minutes = 0): string {
  return new Date(Date.UTC(day.y, day.m, day.d, hours - MSK_OFFSET_H, minutes)).toISOString();
}
/** All-day events are date-only: UTC midnight of the calendar date. */
function dateOnly(day: Day, plusDays = 0): string {
  return new Date(Date.UTC(day.y, day.m, day.d + plusDays)).toISOString();
}

const LONG_TITLE = "Созвон с подрядчиком по смете на замену окон в спальне и детской";

for (const pluginsOff of [false, true]) {
  test(`calendar week and day: overlaps, all-day, overnight, keyboard; 1440, 768, 390, 320 (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const account = await register(request, "cal-week");
    if (pluginsOff) await disableAllPlugins(request, account);
    const seeded = await seedProjects(request, account);
    const post = async (data: Record<string, unknown>) => {
      const response = await request.post(`${seeded.base}/events`, { headers: seeded.headers, data: { reminders: [], allDay: false, ...data } });
      expect(response.ok(), await response.text()).toBe(true);
    };
    const today = mskToday();
    const monday = plus(today, -weekday(today));
    // The overnight event must stay inside this Monday-first week to show both of its days.
    const night = weekday(today) === 6 ? plus(today, -1) : today;
    const nextDay = plus(night, 1);
    await post({ title: "Планёрка", startAt: at(today, 10), endAt: at(today, 11, 30) });
    await post({ title: LONG_TITLE, startAt: at(today, 10, 30), endAt: at(today, 12) });
    await post({ title: "Обед", startAt: at(today, 11), endAt: at(today, 11, 45) });
    await post({ title: "Ночной перелёт в Петрозаводск", startAt: at(night, 22), endAt: at(nextDay, 2) });
    await post({ title: "Зарядка", startAt: at(today, 7), endAt: at(today, 7, 30), recurrence: { freq: "daily", interval: 1, until: null, count: 5 } });
    await post({ title: "Отпуск", startAt: dateOnly(monday), endAt: dateOnly(monday, 3), allDay: true });
    await post({ title: "День рождения мамы", startAt: dateOnly(today), endAt: dateOnly(today, 1), allDay: true });
    await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });

    await signIn(page, account);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Календарь", exact: true }).click();
    const calendar = page.getByRole("group", { name: "Календарь", exact: true });
    const tab = (name: string) => calendar.getByRole("tab", { name, exact: true });

    await tab("Неделя").click();
    await expect(tab("Неделя")).toHaveAttribute("aria-selected", "true");
    const flight = calendar.getByRole("button", { name: /Ночной перелёт/ });
    await expect(flight.first()).toBeVisible();
    // An overnight event belongs to both of its days and keeps its real length on the first one.
    expect.soft(await flight.count(), "overnight event shows on both days").toBe(2);
    expect.soft((await flight.first().boundingBox())?.height ?? 0, "overnight event keeps its height").toBeGreaterThanOrEqual(60);
    await expect(calendar.getByRole("button", { name: /^Планёрка/ })).toBeVisible();
    await expect(calendar.getByRole("button", { name: /^Обед/ })).toBeVisible();
    await shot(page, pluginsOff ? "week-1440-plugins-off" : "week-1440");

    // Keyboard: Tab reaches an event, Enter opens it.
    const planning = calendar.getByRole("button", { name: /^Планёрка/ });
    await page.keyboard.press("Tab"); // keyboard modality, so focus shows the way it does for a keyboard user
    await planning.focus();
    expect.soft(await planning.evaluate((node) => getComputedStyle(node).boxShadow !== "none" || getComputedStyle(node).outlineStyle !== "none"), "focused event shows focus").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Событие" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Day view: the three overlapping events side by side, the long title readable beyond one line.
    await tab("День").click();
    await expect(tab("День")).toHaveAttribute("aria-selected", "true");
    const long = calendar.getByRole("button", { name: new RegExp(`^${LONG_TITLE}`) });
    await expect(long).toBeVisible();
    expect.soft(await long.evaluate((node) => {
      const title = node.querySelector("[data-event-title]") ?? node;
      return title.getBoundingClientRect().height > 20;
    }), "long title wraps in the day view").toBe(true);
    if (!pluginsOff) await shot(page, "day-1440");

    // Reload keeps the view (it is saved with a short debounce).
    await page.waitForTimeout(800);
    await page.reload();
    await page.getByRole("button", { name: "Календарь", exact: true }).click();
    await expect(page.getByRole("group", { name: "Календарь", exact: true }).getByRole("tab", { name: "День", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("group", { name: "Календарь", exact: true }).getByRole("tab", { name: "Неделя", exact: true }).click();

    // Narrow: the grid may scroll inside itself, the page never does; days stay readable.
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const grid = page.getByRole("group", { name: "Календарь", exact: true });
      await expect(grid.getByRole("button", { name: /^Планёрка/ })).toBeAttached();
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}`).toBe(true);
      const columnWidth = await grid.getByRole("button", { name: /^Планёрка/ }).evaluate((node) => node.parentElement?.getBoundingClientRect().width ?? 0);
      expect.soft(columnWidth, `day column readable at ${width}`).toBeGreaterThanOrEqual(72);
      if (!pluginsOff) await shot(page, `week-${width}`);
    }
  });
}
