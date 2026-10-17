import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

for (const mode of ["dark", "light"] as const) {
  test(`saved ${mode} own theme survives a fresh session and rolls back to a preset without deletion`, async ({ page, request, browser }) => {
    test.setTimeout(120_000);
    const account = await register(request, `saved-theme-${mode}`);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision", accent: "blue", backgroundStyle: "grid" } });
    await signIn(page, account); await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
    const library = page.getByRole("region", { name: "Библиотека тем", exact: true });
    await library.getByRole("button", { name: `Открыть тему «${mode === "light" ? "Arctic" : "KAIDEN Precision"}» в редакторе`, exact: true }).click();
    const region = page.getByRole("region", { name: "Редактор темы", exact: true });
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
      await page.route("**/settings/themes/*", async route => {
        if (route.request().method() === "PUT") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Тестовый сбой записи" }) });
        else await route.continue();
      });
      await region.getByRole("button", { name: "Сохранить и применить", exact: true }).click();
      await expect(region.getByRole("alert")).toContainText("Не удалось сохранить тему");
      await expect(region.getByLabel("Название темы", { exact: true })).toHaveValue("Моя тема dark");
      await expect(page.locator("html")).toHaveAttribute("data-orion-palette", "kaiden-precision");
      await page.unroute("**/settings/themes/*");
    }
    await region.getByRole("button", { name: "Сохранить и применить", exact: true }).click();
    await expect(region).toContainText("Тема сохранена в вашей библиотеке и применена.");
    const saved = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
    const entry = saved.themeLibrary.find((e: { document: { name: string } }) => e.document.name === `Моя тема ${mode}`);
    expect(entry).toMatchObject({ document: { baseMode: mode, colors: { accent: "#357ab5" } } });
    expect(saved).toMatchObject({ activeThemeId: entry.document.id, accent: "blue", backgroundStyle: "grid" });
    await expect(page.locator("html")).toHaveAttribute("data-orion-palette", entry.document.id);
    expect(await page.locator("html").evaluate(node => getComputedStyle(node).getPropertyValue("--kaiden-accent-base").trim())).toBe("53 122 181");
    expect(await page.locator("html").evaluate(node => getComputedStyle(node).colorScheme)).toBe(mode);
    await page.mouse.move(0, 0); // the button was just clicked; read its resting colour, not the hover one
    await expect(region.getByRole("button", { name: "Сохранить и применить", exact: true })).toHaveCSS("background-color", "rgb(53, 122, 181)");
    await expect(page.locator("body")).toHaveCSS("background-color", mode === "light" ? "rgb(245, 246, 248)" : "rgb(15, 16, 18)");
    await expect(library.getByText("Выбрана", { exact: true })).toHaveCount(1);
    await page.screenshot({ path: `tmp/redesign/saved-custom-theme-${mode}.png` });

    // Brand-new storage/session: only authentication is seeded, no palette cache is copied.
    const freshContext = await browser.newContext(); const fresh = await freshContext.newPage();
    await signIn(fresh, account); await fresh.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await expect(fresh.locator("html")).toHaveAttribute("data-orion-palette", entry.document.id);
    await freshContext.close();
    await page.reload();
    await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
    await library.getByRole("button", { name: `Открыть тему «Моя тема ${mode}» в редакторе`, exact: true }).click();
    await expect(region.getByLabel("Название темы", { exact: true })).toHaveValue(`Моя тема ${mode}`);
    await expect(region.getByLabel("Акцент", { exact: true })).toHaveValue("#357ab5");
    await expect(region).toContainText("Сохранено в вашей библиотеке.");
    const detached = await page.context().newPage();
    await detached.goto(`/panel/tasks?workspaceId=${account.workspaceId}`);
    await expect(detached.locator("html")).toHaveAttribute("data-orion-palette", entry.document.id);
    await library.getByRole("button", { name: "Применить тему «KAIDEN Precision»", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-orion-palette", "kaiden-precision");
    await expect(detached.locator("html")).toHaveAttribute("data-orion-palette", "kaiden-precision");
    const rolledBack = await (await request.get(`${apiUrl()}/settings/preferences`, { headers })).json();
    expect(rolledBack).toMatchObject({ activeThemeId: "kaiden-precision", themeLibrary: [entry], accent: "blue", backgroundStyle: "grid" });
    await detached.close();
  });
}
