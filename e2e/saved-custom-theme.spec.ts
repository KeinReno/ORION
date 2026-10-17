import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

for (const mode of ["dark", "light"] as const) {
  test(`saved ${mode} user palette survives a fresh session and rolls back without deletion`, async ({ page, request, browser }) => {
    test.setTimeout(120_000);
    const account = await register(request, `saved-theme-${mode}`);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision", accent: "blue", backgroundStyle: "grid" } });
    await signIn(page, account); await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Предпросмотр тем" }).click();
    const region = page.getByRole("region", { name: "Предпросмотр тем", exact: true });
    if (mode === "light") await region.getByRole("combobox", { name: "Палитра образца", exact: true }).selectOption("arctic");
    await region.getByRole("button", { name: "Создать копию", exact: true }).click();
    await region.getByLabel("Название темы", { exact: true }).fill("");
    await expect(region.getByRole("button", { name: "Сохранить и применить", exact: true })).toBeDisabled();
    await region.getByRole("button", { name: "Экспортировать тему", exact: true }).click();
    await expect(region.getByRole("alert")).toContainText("Название темы должно содержать");
    await region.getByLabel("Название темы", { exact: true }).fill(`Моя тема ${mode}`);
    await region.getByLabel("Акцент", { exact: true }).fill("#357ab5");
    await expect(region.getByRole("button", { name: "Отменить предпросмотр", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-orion-palette", "kaiden-precision");
    await region.getByRole("button", { name: "Отменить предпросмотр", exact: true }).click();
    if (mode === "dark") {
      await page.route("**/settings/preferences", async route => {
        if (route.request().method() === "PATCH") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Тестовый сбой записи" }) });
        else await route.continue();
      });
      await region.getByRole("button", { name: "Сохранить и применить", exact: true }).click();
      await expect(region.getByRole("alert")).toContainText("Не удалось сохранить тему");
      await expect(region.getByLabel("Название темы", { exact: true })).toHaveValue("Моя тема dark");
      await expect(page.locator("html")).toHaveAttribute("data-orion-palette", "kaiden-precision");
      await page.unroute("**/settings/preferences");
    }
    await region.getByRole("button", { name: "Сохранить и применить", exact: true }).click();
    await expect(region).toContainText("Тема сохранена в учётной записи и применена.");
    const saved = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
    expect(saved).toMatchObject({ customThemeEnabled: true, customTheme: { name: `Моя тема ${mode}`, baseMode: mode, colors: { accent: "#357ab5" } }, accent: "blue", backgroundStyle: "grid" });
    await expect(page.locator("html")).toHaveAttribute("data-orion-palette", saved.customTheme.id);
    expect(await page.locator("html").evaluate(node => getComputedStyle(node).getPropertyValue("--kaiden-accent-base").trim())).toBe("53 122 181");
    expect(await page.locator("html").evaluate(node => getComputedStyle(node).colorScheme)).toBe(mode);
    await expect(region.getByRole("button", { name: "Сохранить и применить", exact: true })).toHaveCSS("background-color", "rgb(53, 122, 181)");
    await expect(page.locator("body")).toHaveCSS("background-color", mode === "light" ? "rgb(245, 246, 248)" : "rgb(15, 16, 18)");
    await page.screenshot({ path: `tmp/redesign/saved-custom-theme-${mode}.png` });

    // Brand-new storage/session: only authentication is seeded, no palette cache is copied.
    const freshContext = await browser.newContext(); const fresh = await freshContext.newPage();
    await signIn(fresh, account); await fresh.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await expect(fresh.locator("html")).toHaveAttribute("data-orion-palette", saved.customTheme.id);
    await freshContext.close();
    await page.reload();
    await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Предпросмотр тем" }).click();
    await region.getByRole("button", { name: "Загрузить сохранённую", exact: true }).click();
    await expect(region.getByLabel("Название темы", { exact: true })).toHaveValue(`Моя тема ${mode}`);
    await expect(region.getByLabel("Акцент", { exact: true })).toHaveValue("#357ab5");
    const detached = await page.context().newPage();
    await detached.goto(`/panel/tasks?workspaceId=${account.workspaceId}`);
    await expect(detached.locator("html")).toHaveAttribute("data-orion-palette", saved.customTheme.id);
    await region.getByRole("button", { name: "Вернуть стандартную палитру", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-orion-palette", "kaiden-precision");
    await expect(detached.locator("html")).toHaveAttribute("data-orion-palette", "kaiden-precision");
    const disabled = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
    expect(disabled).toMatchObject({ customThemeEnabled: false, customTheme: saved.customTheme, accent: "blue", backgroundStyle: "grid" });
    await detached.close();
  });
}
