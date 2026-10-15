import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

/**
 * «Списки» through the real UI: the board shows every entry (not just six), a list opens as its own panel
 * where entries are added with a quantity, edited, reordered and ticked (with who ticked), «Очистить
 * отмеченные» can be undone whole, and the «Покупки → Финансы» plugin books the bought entries as one expense.
 * Setup goes through the API.
 */
test("a list opens fully, edits entries, undoes «очистить» and books a receipt", async ({ page, request }) => {
  const account: Account = await register(request, "lists");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const created = await request.post(`${ws}/lists`, { headers, data: { name: "E2E продукты", kind: "shopping" } });
  const list = (await created.json()) as { id: string };
  await request.post(`${ws}/lists/${list.id}/items/bulk`, {
    headers,
    data: { items: ["Хлеб", "Молоко", "Сыр", "Яйца", "Масло", "Чай", "Кофе", "Сахар"].map((label) => ({ label })) }
  });
  const accountRow = await request.post(`${ws}/finance/accounts`, { headers, data: { name: "E2E карта", startingBalance: 500_000 } });
  expect(accountRow.status()).toBe(201);

  await signIn(page, account);

  // The board previews six and can show them all.
  await page.goto(`/panel/lists?workspaceId=${account.workspaceId}`);
  const card = page.locator("div.rounded-xl", { hasText: "E2E продукты" });
  await expect(card.getByRole("checkbox")).toHaveCount(6);
  await card.getByRole("button", { name: /Показать все/ }).click();
  await expect(card.getByRole("checkbox")).toHaveCount(8);

  // The list as its own panel.
  await page.goto(`/panel/list?instance=${list.id}&workspaceId=${account.workspaceId}`);
  await expect(page.getByText("E2E продукты").first()).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(8);

  // «Молоко, 2 л» becomes an entry with a quantity and a unit.
  await page.getByPlaceholder(/Добавить пункт/).fill("Кефир, 2 л");
  await page.getByPlaceholder(/Добавить пункт/).press("Enter");
  const kefir = page.locator("li", { hasText: "Кефир" });
  await expect(kefir).toBeVisible();
  await expect(kefir.getByText("2 л")).toBeVisible();

  // Edit the entry: new text, a price, then move it up.
  await kefir.getByRole("button", { name: "Кефир" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Текст").fill("Кефир 1%");
  await editor.getByLabel(/Цена/).fill("95");
  await editor.getByRole("button", { name: "Выше" }).click();
  await editor.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator("li", { hasText: "Кефир 1%" })).toBeVisible();
  const order = async (): Promise<string[]> => {
    const lists = (await (await request.get(`${ws}/lists/${list.id}`, { headers })).json()) as { items: { label: string }[] };
    return lists.items.map((item) => item.label);
  };
  await expect.poll(async () => (await order()).at(-2)).toBe("Кефир 1%");

  // Tick two entries; the second one carries a price for the receipt.
  await page.getByRole("checkbox", { name: "Хлеб" }).click();
  await page.getByRole("checkbox", { name: "Кефир 1%" }).click();
  await expect(page.getByText("E2E lists").first()).toBeVisible(); // who ticked (the account's name)

  // «Очистить отмеченные» → «Отменить» puts the very same entries back.
  await page.getByRole("button", { name: /Очистить отмеченные \(2\)/ }).click();
  await expect(page.getByRole("checkbox", { name: "Хлеб" })).toHaveCount(0);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByRole("checkbox", { name: "Хлеб" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Хлеб" })).toHaveAttribute("aria-checked", "true");

  // «Записать расход»: one expense for the bought entries.
  await page.getByRole("button", { name: "Записать расход" }).click();
  const dialog = page.getByRole("dialog", { name: "Записать расход" });
  await dialog.getByLabel(/Сумма чека/).fill("340");
  await dialog.getByRole("button", { name: "Записать" }).click();
  await expect(page.getByText(/Расход записан/)).toBeVisible();
  const transactions = (await (await request.get(`${ws}/finance/transactions`, { headers })).json()) as { type: string; lines: { amount: number }[] }[];
  expect(transactions.filter((t) => t.type === "expense").map((t) => t.lines[0]?.amount)).toEqual([34000]);
  await expect(page.getByRole("button", { name: "Записать расход" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Записано в финансах" }).first()).toBeVisible();
});

test("pasting several lines adds them all, groups included", async ({ page, request }) => {
  const account: Account = await register(request, "lists-paste");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const list = (await (await request.post(`${ws}/lists`, { headers, data: { name: "E2E вставка" } })).json()) as { id: string };
  await signIn(page, account);
  await page.goto(`/panel/list?instance=${list.id}&workspaceId=${account.workspaceId}`);

  await page.getByRole("button", { name: "Вставить списком" }).click();
  const dialog = page.getByRole("dialog", { name: "Вставить списком" });
  await dialog.getByRole("textbox").fill("Мыло\n# Овощи\nМорковь, 2 кг\n[x] Лук");
  await dialog.getByRole("button", { name: /Добавить \(3\)/ }).click();

  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: /Овощи/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Лук" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("li", { hasText: "Морковь" }).getByText("2 кг")).toBeVisible();
});
