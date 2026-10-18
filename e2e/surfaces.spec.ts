import { expect, test } from "@playwright/test";
import { register, signIn } from "./support";

test.use({ reducedMotion: "reduce", actionTimeout: 15_000 });

/**
 * Surface API (G17): один и тот же компонент («Календарь») открывается на трёх поверхностях, которые
 * манифест объявляет для модуля `calendar` (`surfaces`): вкладка дока, плавающее окно дока и окно ОС
 * (маршрут `/panel/<id>`, тот же, что открывает WebviewWindow в Tauri). Узнаваемый признак компонента —
 * поле «Найти на календаре». Настоящее открепление в Tauri проверяется вручную (Windows).
 */
test("calendar opens as a dock tab, a floating window and a detached-window route", async ({ page, request }) => {
  test.setTimeout(120_000);
  const account = await register(request, "surfaces");
  const marker = page.getByLabel("Найти на календаре");
  await signIn(page, account);
  await page.setViewportSize({ width: 1920, height: 1080 });

  // 1. Вкладка дока.
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await expect(marker).toBeVisible();

  // 2. Плавающее окно: та же панель, перенесённая из дока.
  await page.getByTitle("Сделать плавающим окном").click();
  await expect(page.getByTitle("Вернуть в рабочую область")).toBeVisible();
  await expect(marker).toBeVisible();

  // 3. Окно ОС: отдельная страница без оболочки.
  await page.goto(`/panel/calendar?workspaceId=${account.workspaceId}`);
  await expect(page.getByText("Загрузка…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(marker).toBeVisible();
  await expect(page.getByText(/нельзя открыть в отдельном окне/)).toHaveCount(0);
});
