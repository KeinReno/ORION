import { expect, test } from "@playwright/test";
import { register, signIn } from "./support";

for (const width of [1280, 390, 320]) {
  test(`inbox captures the first thought at ${width}px`, async ({ page, request }, testInfo) => {
    const account = await register(request, `inbox-entry-${width}`);
    await signIn(page, account);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/panel/inbox?workspaceId=${account.workspaceId}`);

    await expect(page.getByRole("heading", { name: "Освободите голову" })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Новая запись в инбокс" });
    const add = page.getByRole("button", { name: "Добавить" });
    await expect(add).toBeDisabled();
    await input.fill("Идея для первого разбора");
    await expect(add).toBeEnabled();

    if (width <= 390) {
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits, "the empty inbox fits the mobile viewport").toBe(true);
    }

    await testInfo.attach(`empty-inbox-${width}.png`, {
      body: await page.screenshot({ fullPage: true, path: `tmp/inbox-entry-${width}.png` }),
      contentType: "image/png"
    });

    if (width === 1280) await input.press("Enter");
    else await add.click();
    await expect(page.getByRole("heading", { name: "Освободите голову" })).toHaveCount(0);
    await expect(page.getByText("Идея для первого разбора", { exact: true })).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(page.getByRole("button", { name: "Добавить" })).toBeDisabled();
    if (width <= 390) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await testInfo.attach(`queue-inbox-${width}.png`, {
      body: await page.screenshot({ fullPage: true, path: `tmp/inbox-queue-${width}.png` }),
      contentType: "image/png"
    });

    if (width === 1280) {
      await input.fill("Вторая запись");
      await add.click();
      await expect(page.getByRole("heading", { name: "Дальше в очереди" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Идея для первого разбора/ })).toBeVisible();
      await expect(page.getByText("Вторая запись", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Идея для первого разбора", { exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "В заметку" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Создать" }).click();
      await expect(page.getByText("Заметка создана")).toBeVisible();
      await page.getByRole("tab", { name: "История" }).click();
      await expect(page.getByText(/→ Заметка/)).toBeVisible();
      await expect(page.getByText("Идея для первого разбора", { exact: true })).toHaveCount(0);
      await testInfo.attach("inbox-history-1280.png", {
        body: await page.screenshot({ fullPage: true, path: "tmp/inbox-history-1280.png" }),
        contentType: "image/png"
      });
    }
  });
}
