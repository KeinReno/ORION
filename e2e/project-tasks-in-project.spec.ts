import { expect, test, type Page } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** The global Tasks panel never opens: a project's task opens on the project's own «Задачи» tab. */
async function expectTaskInProject(page: Page, title: string): Promise<void> {
  const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
  await expect(detail.getByRole("textbox", { name: "Название задачи", exact: true })).toHaveValue(title);
  await expect(page.getByRole("tab", { name: /^Задачи/ }).first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".dv-tab").filter({ hasText: /^\s*Задачи\s*$/ })).toHaveCount(0);
}

for (const pluginsOff of [false, true]) {
  test(`a task opened from inside a project stays in the project (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const account = await register(request, "project-tasks-inside");
    if (pluginsOff) await disableAllPlugins(request, account);
    const seeded = await seedProjects(request, account);
    await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Проекты", exact: true }).click();
    await page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true }).click();

    // «Последние изменения» on the overview: a closed task that is in no other overview list.
    const activity = page.locator("section").filter({ has: page.getByRole("heading", { name: "Последние изменения", exact: true }) });
    await activity.getByText("Скачать офлайн-карты", { exact: true }).click();
    await expectTaskInProject(page, "Скачать офлайн-карты");

    // From outside the project — search (Ctrl+K) from the dashboard: a project's task still opens in its project.
    await page.getByRole("button", { name: "Сегодня", exact: true }).or(page.getByRole("button", { name: "Дашборд", exact: true })).first().click();
    const palette = page.getByRole("dialog", { name: "Поиск и команды", exact: true });
    await page.getByRole("button", { name: "Поиск и команды", exact: true }).click();
    await palette.getByRole("textbox", { name: "Поиск команд и записей", exact: true }).fill("Составить список снаряжения");
    await expect(palette.getByRole("button", { name: "Открытие: Составить список снаряжения", exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(palette).not.toBeVisible();
    await expectTaskInProject(page, "Составить список снаряжения");

    if (!pluginsOff) {
      // The plan (Gantt) of the projects-planning plugin.
      await page.getByRole("tab", { name: /^План/ }).first().click();
      await page.getByRole("button", { name: "Забронировать домик у озера", exact: true }).first().click();
      await expectTaskInProject(page, "Забронировать домик у озера");
    }
  });
}
