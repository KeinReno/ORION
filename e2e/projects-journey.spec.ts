import { expect, test } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

for (const pluginsOff of [false, true]) {
  test(`project board → project → task → linked note → back to the project (${pluginsOff ? "plugins-off" : "default-full"})`, async ({ page, request }) => {
    test.setTimeout(150_000);
    const account = await register(request, "projects-journey");
    if (pluginsOff) await disableAllPlugins(request, account);
    const seeded = await seedProjects(request, account);
    await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
    await signIn(page, account);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Проекты", exact: true }).click();

    // The band names the project that needs attention and the reasons in words.
    const band = page.getByRole("region", { name: "Требует внимания", exact: true });
    await expect(band).toBeVisible();
    await expect(band).toContainText("Автор отметил задержку");
    await expect(band).toContainText("Срок прошёл 3 дня назад");
    await expect(band).not.toContainText("Поездка в Карелию");
    // Keyboard: focus the band item and open the project with Enter.
    await band.getByRole("button").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".dv-tab").filter({ hasText: seeded.site.name.slice(0, 12) })).toHaveCount(1);
    await page.getByRole("button", { name: "Проекты", exact: true }).click();

    // Mouse: open the trip from the list, answer the first-screen questions from the glance cells.
    await page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true }).click();
    const glance = page.getByRole("list", { name: "Сейчас" }).or(page.locator('dl[aria-label="Сейчас"]'));
    await expect(glance).toContainText("Забронировать домик у озера");
    if (!pluginsOff) await expect(glance).toContainText("Бронирование завершено");
    await expect(glance).toContainText("через 40 дней");
    await page.screenshot({ path: "tmp/redesign/projects-journey-overview.png" });

    // Task from the overview list, then its linked note beside the project.
    await page.getByText(seeded.task.title, { exact: true }).first().click();
    const detail = page.getByRole("region", { name: "Детали задачи", exact: true });
    await expect(detail.getByRole("textbox", { name: "Название задачи", exact: true })).toHaveValue(seeded.task.title);
    await detail.getByRole("tab", { name: "Связи", exact: true }).click();
    await detail.getByRole("button", { name: `Открытие: ${seeded.note.title}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Открыть в новой вкладке", exact: true }).click();
    const noteTitle = page.getByRole("textbox", { name: "Название заметки", exact: true });
    await expect(noteTitle).toHaveValue(seeded.note.title);
    await noteTitle.fill("Маршрут по Карелии — правка");
    await expect.poll(async () => (await (await request.get(`${seeded.base}/notes/${seeded.note.id}`, { headers: seeded.headers })).json()).title).toBe("Маршрут по Карелии — правка");

    // Back to the project with the keyboard: same tab, same open task, nothing duplicated.
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(detail.getByRole("textbox", { name: "Название задачи", exact: true })).toHaveValue(seeded.task.title);
    await expect(page.locator(".dv-tab").filter({ hasText: "Поездка в Карелию" })).toHaveCount(1);
    await expect(page.locator(".dv-tab").filter({ hasText: "Маршрут по Карелии" })).toHaveCount(1);
    const notes = (await (await request.get(`${seeded.base}/notes`, { headers: seeded.headers })).json()) as { id: string; projectId: string | null }[];
    expect(notes.filter(n => n.id === seeded.note.id)).toHaveLength(1);
    expect(notes.find(n => n.id === seeded.note.id)?.projectId).toBe(seeded.trip.id);
  });
}
