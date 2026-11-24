import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test("Precision colors and button states preserve saved appearance preferences and compact layout", async ({ page, request }) => {
  const account = await register(request, "theme-foundation");
  await signIn(page, account);
  for (const accent of ["violet", "blue", "green", "amber", "rose"]) {
    const response = await request.patch(`${apiUrl()}/settings/preferences`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      data: { accent, density: "comfortable", surfaceStyle: "solid" }
    });
    expect(response.ok()).toBe(true);
    await page.goto(`/panel/tasks?workspaceId=${account.workspaceId}`);
    const create = page.locator("header").getByRole("button", { name: "Новая задача", exact: true });
    await expect(create).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-accent", accent);
    await expect(page.locator("html")).toHaveAttribute("data-orion-design", "precision");
    await page.mouse.move(0, 0);
    await expect(create).toHaveCSS("background-color", "rgb(201, 168, 106)");
    await expect(create).toHaveCSS("color", "rgb(22, 23, 26)");
    await create.hover();
    await expect(create).toHaveCSS("background-color", "rgb(222, 192, 139)");
  }
  const response = await request.patch(`${apiUrl()}/settings/preferences`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    data: { density: "compact", surfaceStyle: "glass", panelOpacity: 0.6, panelBlur: 16, panelAccent: "#0d0d11" }
  });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-surface", "glass");
  const create = page.locator("header").getByRole("button", { name: "Новая задача", exact: true });
  await expect(create).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-orion-design", "precision");
  await create.focus();
  await expect(create).toBeFocused();
  await expect(create).not.toHaveCSS("box-shadow", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await create.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

