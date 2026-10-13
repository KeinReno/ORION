import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

/**
 * Plugin «Покупки → Склад» (ADR-0009) through the real UI: link a shopping-list
 * entry to a stock item, tick it («Куплено» → one receipt), then send the stock
 * item back to the list from its window. Setup goes through the API.
 */
test("a shopping list restocks inventory once, and stock goes back to the list", async ({ page, request }) => {
  const account: Account = await register(request, "bridge");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const list = (await (await request.post(`${ws}/lists`, { headers, data: { name: "E2E покупки" } })).json()) as { id: string };
  await request.post(`${ws}/lists/${list.id}/items`, { headers, data: { label: "Фильтр" } });
  const stock = (await (await request.post(`${ws}/inventory/items`, { headers, data: { name: "Фильтр для воды", minStock: 2 } })).json()) as {
    id: string;
  };
  const balance = async (): Promise<number> => {
    const items = (await (await request.get(`${ws}/inventory/items`, { headers })).json()) as { id: string; balance: number }[];
    return items.find((item) => item.id === stock.id)?.balance ?? -1;
  };

  await signIn(page, account);
  await page.goto(`/panel/lists?workspaceId=${account.workspaceId}`);
  const card = page.locator("div.rounded-xl", { hasText: "E2E покупки" });
  const row = card.locator("li", { hasText: "Фильтр" });
  await expect(row).toBeVisible();

  // Link the entry to the stock item, 3 units per purchase.
  await row.hover();
  await row.getByRole("button", { name: "Связать со складом" }).click();
  const dialog = page.getByRole("dialog", { name: "Связь со складом" });
  await dialog.getByLabel("Позиция склада").selectOption({ label: "Фильтр для воды — остаток 0 шт" });
  await dialog.getByLabel("Сколько добавить на склад при покупке").fill("3");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(row.getByRole("button", { name: /×3/ })).toBeVisible();

  // «Куплено»: ticking writes the receipt; ticking again after unticking does not.
  await row.getByRole("checkbox", { name: "Фильтр" }).click();
  await expect(row.getByRole("button", { name: /×3 · на складе/ })).toBeVisible();
  await expect.poll(balance).toBe(3);
  await row.getByRole("checkbox", { name: "Фильтр" }).click();
  await expect(row.getByRole("checkbox", { name: "Фильтр" })).toHaveAttribute("aria-checked", "false");
  await row.getByRole("checkbox", { name: "Фильтр" }).click();
  await expect(row.getByRole("checkbox", { name: "Фильтр" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(balance).toBe(3);

  // From the stock item's window back to the shopping list.
  await page.goto(`/panel/inventory?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Открыть позицию Фильтр для воды" }).click();
  await page.getByRole("button", { name: "В список покупок" }).click();
  const toList = page.getByRole("dialog", { name: "В список покупок" });
  await toList.getByLabel("Список").selectOption({ label: "E2E покупки" });
  // Balance 3 is above the threshold 2 → the suggestion is a single unit.
  await expect(toList.getByLabel("Сколько купить, шт")).toHaveValue("1");
  await toList.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText("В «E2E покупки»: Фильтр для воды ×1")).toBeVisible();

  const lists = (await (await request.get(`${ws}/lists`, { headers })).json()) as { id: string; items: { label: string; inventoryItemId: string | null }[] }[];
  expect(lists.find((entry) => entry.id === list.id)?.items.filter((item) => item.inventoryItemId === stock.id).map((item) => item.label)).toEqual(["Фильтр", "Фильтр для воды"]);
});
