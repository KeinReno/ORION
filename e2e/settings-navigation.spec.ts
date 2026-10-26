import { expect, test } from "@playwright/test";
import { register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

test("settings: grouped by who a change affects, search lands on the field, profile stays in the workbench", async ({ page, request }) => {
  const account = await register(request, "settings-navigation");
  await signIn(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();

  const nav = page.getByRole("navigation", { name: "Разделы настроек", exact: true });
  await expect(nav).toContainText("Ваша учётная запись");
  await expect(nav).toContainText("Этот компьютер");
  for (const group of await nav.locator("button[aria-expanded]").all()) {
    if (await group.getAttribute("aria-expanded") === "false") await group.click();
  }
  await expect(page.getByText("Только для вас — во всех ваших пространствах и на всех устройствах.")).toBeVisible();

  // «Анимации» is a personal appearance option; switching it is saved and marks <html>.
  await nav.getByRole("button", { name: "Внешний вид", exact: true }).click();
  await page.getByRole("tab", { name: "Выключены", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await page.getByRole("tab", { name: "Спокойные", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "calm");

  // A workspace tab names the workspace it changes.
  await nav.getByRole("button", { name: "Модули", exact: true }).click();
  await expect(page.getByText(/^Для всех участников «.+»\.$/)).toBeVisible();

  // The parameter search switches the tab and focuses the field itself.
  await page.getByRole("searchbox", { name: "Найти настройку", exact: true }).fill("тихие");
  await page.getByRole("button", { name: /^Тихие часы/ }).click();
  await expect(page.getByLabel("Тихие часы — начало", { exact: true })).toBeFocused();

  // Appearance no longer carries the time zone, dashboard widget ids or the theme library.
  await nav.getByRole("button", { name: "Внешний вид", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Оформление Orion", exact: true })).toBeVisible();
  await expect(page.getByText("Часовой пояс", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Библиотека тем", exact: true })).toHaveCount(0);

  // An unknown time zone is explained and not saved.
  await nav.getByRole("button", { name: "Дата и время", exact: true }).click();
  await page.getByLabel("Часовой пояс", { exact: true }).fill("Марс/Олимп");
  await expect(page.getByRole("alert").filter({ hasText: "Такого часового пояса нет" })).toBeVisible();

  // The module sheet holds only module things (Notes: its own display option); the app-wide look is one click away.
  await page.getByRole("navigation", { name: "Разделы", exact: true }).getByRole("button", { name: "Заметки", exact: true }).click();
  await page.getByRole("button", { name: "Настройки модуля", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "Настройки: Заметки", exact: true });
  await expect(sheet.getByRole("switch", { name: "Номера заметок", exact: true })).toBeVisible();
  await expect(sheet.getByText("Акцент", { exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Внешний вид приложения", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Оформление Orion", exact: true })).toBeVisible();

  // The account opens as the profile tab, without leaving the workbench (Precision header avatar).
  await page.getByRole("combobox", { name: "Оформление Orion", exact: true }).selectOption("kaiden-precision");
  await expect(page.locator("html")).toHaveAttribute("data-orion-design", "precision");
  await nav.getByRole("button", { name: "Обновления", exact: true }).click();
  await page.getByRole("button", { name: "Учётная запись", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Загрузить фото", { exact: true })).toBeVisible();
});
