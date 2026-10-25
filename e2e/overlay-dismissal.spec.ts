import { expect, test } from "@playwright/test";
import { register, signIn } from "./support";

test.use({ actionTimeout: 15_000 });

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`modal releases its backdrop after an interrupted shared-layout animation (${reducedMotion})`, async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion });
    const account = await register(request, "overlay-dismissal");
    await signIn(page, account);
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Контакты", exact: true }).click();
    const launcher = page.getByRole("button", { name: "Сообщить о баге или предложить идею", exact: true });
    const dialog = page.getByRole("dialog", { name: "Обратная связь", exact: true });
    for (const close of ["escape", "button"] as const) {
      await launcher.click();
      await dialog.getByRole("tab", { name: "Предложить идею", exact: true }).click();
      await dialog.getByRole("tab", { name: "Сообщить о баге", exact: true }).click();
      if (close === "escape") await page.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(launcher).toBeFocused();
      // A real click verifies that a transparent, pointer-active backdrop is gone.
      await page.getByRole("button", { name: "Новый контакт", exact: true }).first().click();
      const create = page.getByRole("dialog", { name: "Новый контакт", exact: true });
      await expect(create).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(create).toHaveCount(0);
    }
  });
}
