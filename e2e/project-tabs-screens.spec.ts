import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Every tab inside a project at desktop and phone widths. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/project-tabs";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

/** What sticks out of the viewport, or null — horizontal page scroll is a defect at any width. */
async function overflow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width + 1) return null;
    const culprit = [...document.querySelectorAll<HTMLElement>("body *")].find((el) => el.getBoundingClientRect().right > width + 1);
    return culprit ? `${culprit.tagName}.${culprit.className}`.slice(0, 160) : "document";
  });
}

const TABS = ["Обзор", "Задачи", "План", "Идеи", "Проблемы", "Затраты", "Материалы", "Доступ"] as const;

for (const pluginsOff of [false, true]) {
  test(`project tabs at 1440, 390 and 320: strip or picker, stacked matrix, no overflow (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const account = await register(request, "project-tabs");
    if (pluginsOff) await disableAllPlugins(request, account);
    const seeded = await seedProjects(request, account);
    await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Проекты", exact: true }).click();
    await page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true }).click();
    const strip = page.getByRole("tablist").filter({ has: page.getByRole("tab", { name: "Обзор", exact: true }) }).first();
    await expect(strip).toBeVisible();
    // Plugin tabs leave with their plugins; the module's own tabs stay.
    await expect(strip.getByRole("tab", { name: "План", exact: true })).toHaveCount(pluginsOff ? 0 : 1);
    const available = [];
    for (const name of TABS) if ((await strip.getByRole("tab", { name: new RegExp(`^${name}`) }).count()) > 0) available.push(name);
    expect(available).toEqual(expect.arrayContaining(["Обзор", "Задачи", "Материалы", "Доступ"]));

    const problems: string[] = [];
    for (const name of available) {
      await strip.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
      if (!pluginsOff) await shot(page, `${name}-1440`);
      const sticking = await overflow(page);
      if (sticking) problems.push(`${name} @1440: ${sticking}`);
    }
    // The access tab says what it is for, not just a caption and a button a screen apart.
    await strip.getByRole("tab", { name: "Доступ", exact: true }).click();
    await expect(page.getByText("Участники пространства уже видят проект.", { exact: false })).toBeVisible();

    // Phone widths: one «Раздел» picker instead of a strip wrapping to three rows; every tab still reachable.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const picker = page.getByRole("combobox", { name: "Раздел проекта", exact: true });
      await expect(picker).toBeVisible();
      await expect(page.getByRole("tab", { name: "Обзор", exact: true })).toHaveCount(0);
      for (const name of available) {
        const value = await picker.locator("option", { hasText: new RegExp(`^${name}`) }).getAttribute("value");
        await picker.selectOption(value!);
        if (!pluginsOff) await shot(page, `${name}-${width}`);
        const sticking = await overflow(page);
        if (sticking) problems.push(`${name} @${width}: ${sticking}`);
      }
      // The matrix stacks by urgency: a task without a milestone is on screen, not in a column off to the right.
      await picker.selectOption("tasks");
      await page.getByRole("radiogroup", { name: "Вид задач" }).or(page.getByRole("tablist", { name: "Вид задач" })).getByText("Матрица", { exact: true }).click();
      const stacked = page.getByRole("list", { name: "Задачи по срочности", exact: true });
      await expect(stacked).toBeVisible();
      await expect(stacked.getByRole("button", { name: /^Забронировать домик у озера/ })).toBeInViewport();
      await expect(stacked).toContainText("Без вехи");
    }
    expect(problems, problems.join("\n")).toEqual([]);

    // Back to desktop: the strip returns, the picked tab is kept, the task opens beside the matrix.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(strip.getByRole("tab", { name: /^Задачи/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: "Задачи по направлениям и срочности" })).toBeVisible();
    for (const layout of ["Доска", "Список", "Дерево", "Связи", "Матрица"]) {
      await page.getByRole("radiogroup", { name: "Вид задач" }).or(page.getByRole("tablist", { name: "Вид задач" })).getByText(layout, { exact: true }).click();
      if (!pluginsOff) await shot(page, `tasks-${layout}-1440`);
    }
    await page.getByRole("button", { name: "Забронировать домик у озера" }).first().click();
    const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
    await expect(detail.getByRole("textbox", { name: "Название задачи", exact: true })).toHaveValue("Забронировать домик у озера");
    if (!pluginsOff) await shot(page, "tasks-detail-1440");
  });
}
