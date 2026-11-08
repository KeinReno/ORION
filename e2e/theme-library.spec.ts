import { expect, test } from "@playwright/test";
import { apiUrl, chooseMenu, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

const palette = (page: import("@playwright/test").Page) => page.locator("html");

test("own themes: duplicate, rename, delete the active one, conflict from another device", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await register(request, "theme-library-crud");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
  await signIn(page, account); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/panel/settings?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Темы", exact: true }).click();
  const library = page.getByRole("region", { name: "Библиотека тем", exact: true });

  await library.getByRole("button", { name: "Дублировать тему «Midnight»", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("Создана тема «Midnight — копия»");
  const editor = page.getByRole("region", { name: "Редактор темы", exact: true });
  await editor.getByLabel("Название темы", { exact: true }).fill("Ночная работа");
  await editor.getByRole("button", { name: "Сохранить и применить", exact: true }).click();
  await expect(editor.getByRole("status")).toContainText("Тема сохранена в вашей библиотеке и применена.");
  const prefs = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
  const own = prefs.themeLibrary[0];
  expect(own.document.name).toBe("Ночная работа");
  await expect(palette(page)).toHaveAttribute("data-orion-palette", own.document.id);

  // Another device edits the same theme; saving here then shows the conflict instead of overwriting it.
  const otherDevice = await request.put(`${apiUrl()}/settings/themes/${own.document.id}`, { headers, data: { document: { ...own.document, name: "С другого устройства" }, expectedUpdatedAt: own.updatedAt } });
  expect(otherDevice.ok()).toBe(true);
  await editor.getByLabel("Название темы", { exact: true }).fill("Моя правка");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  const conflict = editor.getByRole("alert");
  await expect(conflict).toContainText("Эту тему уже изменили на другом устройстве");
  await conflict.getByRole("button", { name: "Загрузить версию сервера", exact: true }).click();
  await expect(editor.getByLabel("Название темы", { exact: true })).toHaveValue("С другого устройства");
  await editor.getByLabel("Название темы", { exact: true }).fill("Моя правка");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editor.getByRole("status")).toContainText("Тема сохранена в вашей библиотеке.");

  // Deleting the applied theme falls back to the default palette in the same write.
  await library.getByRole("button", { name: "Удалить тему «Моя правка»", exact: true }).click();
  await page.getByRole("dialog", { name: "Удалить тему?", exact: true }).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("Включена стандартная тема KAIDEN Precision");
  await expect(palette(page)).toHaveAttribute("data-orion-palette", "kaiden-precision");
  await expect(editor).toHaveCount(0);
  const after = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
  expect(after).toMatchObject({ themeLibrary: [], activeThemeId: null });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("workspace theme applies only in its workspace, and «always mine» keeps the own choice", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await register(request, "theme-library-workspace");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision", activeThemeId: "emerald" } });
  const second = await (await request.post(`${apiUrl()}/workspaces`, { headers, data: { name: "Второе пространство" } })).json();
  await signIn(page, account); await page.setViewportSize({ width: 390, height: 860 });
  await page.goto(`/panel/settings?workspaceId=${account.workspaceId}`);
  await chooseMenu(page, "Раздел настроек", "Темы");
  await expect(palette(page)).toHaveAttribute("data-orion-palette", "emerald");
  const section = page.getByRole("region", { name: "Тема пространства", exact: true });
  await chooseMenu(section, "Тема для всех участников", "Arctic");
  await expect(section.getByRole("status")).toContainText("Для пространства выбрана тема «Arctic»");
  await expect(palette(page)).toHaveAttribute("data-orion-palette", "arctic");
  await expect(page.getByRole("region", { name: "Библиотека тем", exact: true })).toContainText("тема пространства");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // A window on another workspace shows the user's own palette, with no Arctic on its root.
  const other = await page.context().newPage();
  await other.setViewportSize({ width: 390, height: 860 });
  await other.goto(`/dashboard?workspaceId=${second.id}`);
  await expect(palette(other)).toHaveAttribute("data-orion-palette", "emerald");
  expect(await palette(other).evaluate(node => getComputedStyle(node).colorScheme)).toBe("dark");
  await other.close();
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await expect(palette(page)).toHaveAttribute("data-orion-palette", "arctic");

  await page.goto(`/panel/settings?workspaceId=${account.workspaceId}`);
  await chooseMenu(page, "Раздел настроек", "Темы");
  await page.getByRole("tab", { name: "Всегда мою тему", exact: true }).click();
  await expect(palette(page)).toHaveAttribute("data-orion-palette", "emerald");
  const prefs = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
  expect(prefs.workspaceThemeMode).toBe("personal");
  const workspaces = await (await request.get(`${apiUrl()}/workspaces/me`, { headers })).json();
  expect(workspaces.find((w: { id: string }) => w.id === account.workspaceId).theme).toMatchObject({ id: "arctic" });
  expect(workspaces.find((w: { id: string }) => w.id === second.id).theme).toBeNull();
});
