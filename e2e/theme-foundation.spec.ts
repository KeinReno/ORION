import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

test("token bridge preserves saved user accents, button states and compact glass layout", async ({ page, request }) => {
  const account = await register(request, "theme-foundation");
  await signIn(page, account);
  const presets = [
    { accent: "violet", base: "rgb(91, 94, 232)", hover: "rgb(124, 127, 243)", foreground: "rgb(255, 255, 255)" },
    { accent: "blue", base: "rgb(37, 99, 235)", hover: "rgb(96, 165, 250)", foreground: "rgb(255, 255, 255)" },
    { accent: "green", base: "rgb(34, 197, 94)", hover: "rgb(74, 222, 128)", foreground: "rgb(8, 8, 12)" },
    { accent: "amber", base: "rgb(245, 158, 11)", hover: "rgb(251, 191, 36)", foreground: "rgb(8, 8, 12)" },
    { accent: "rose", base: "rgb(225, 29, 72)", hover: "rgb(251, 113, 133)", foreground: "rgb(255, 255, 255)" }
  ];
  for (const preset of presets) {
    const response = await request.patch(`${apiUrl()}/settings/preferences`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      data: { accent: preset.accent, density: "comfortable", surfaceStyle: "solid" }
    });
    expect(response.ok()).toBe(true);
    await page.goto(`/panel/tasks?workspaceId=${account.workspaceId}`);
    const create = page.locator("header").getByRole("button", { name: "Новая задача", exact: true });
    await expect(create).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-accent", preset.accent);
    await page.mouse.move(0, 0);
    await expect(create).toHaveCSS("background-color", preset.base);
    await expect(create).toHaveCSS("color", preset.foreground);
    await create.hover();
    await expect(create).toHaveCSS("background-color", preset.hover);
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
  await expect(page.locator("header").first()).toHaveCSS("background-color", "rgba(13, 13, 17, 0.6)");
  await create.focus();
  await expect(create).toBeFocused();
  await expect(create).not.toHaveCSS("box-shadow", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await create.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

