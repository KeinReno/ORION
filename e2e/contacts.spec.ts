import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

/** Module «Контакты» through the real UI: create, find by phone digits, open, edit, see the links block. */
test("a contact is created, found by phone and edited from its card", async ({ page, request }) => {
  const account = await register(request, "contacts");
  await signIn(page, account);
  await page.goto(`/panel/contacts?workspaceId=${account.workspaceId}`);

  await page.getByRole("button", { name: "Новый контакт" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Новый контакт" });
  await dialog.getByLabel("Имя или название").fill("Иван Петров");
  await dialog.getByLabel("Кто это").fill("сантехник");
  await dialog.getByLabel("Телефон").fill("+7 (900) 123-45-67");
  await dialog.getByRole("button", { name: "Добавить" }).click();

  // The new contact opens in its card right away.
  const card = page.getByRole("dialog", { name: "Иван Петров" });
  await expect(card.getByRole("button", { name: "Позвонить" })).toBeVisible();
  await expect(card.getByText("Связанные записи")).toBeVisible();
  await card.getByLabel("Заметка").fill("только по будням");
  await card.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Контакт сохранён")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Поиск по контактам").fill("900 123");
  await expect(page.getByRole("button", { name: "Открыть контакт Иван Петров" })).toBeVisible();
  await page.getByLabel("Поиск по контактам").fill("электрик");
  await expect(page.getByText("Ничего не нашлось")).toBeVisible();

  const contacts = (await (
    await request.get(`${apiUrl()}/workspaces/${account.workspaceId}/contacts`, { headers: { Authorization: `Bearer ${account.accessToken}` } })
  ).json()) as { name: string; note: string; role: string }[];
  expect(contacts).toEqual([expect.objectContaining({ name: "Иван Петров", role: "сантехник", note: "только по будням" })]);
});
