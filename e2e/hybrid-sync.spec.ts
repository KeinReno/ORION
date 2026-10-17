import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

/**
 * ТЗ-06 глазами пользователя: пространство в гибридном режиме работает через локальную копию. Без связи
 * список читается и правится, изменение помечено «на устройстве», а после возврата сети уходит на узел.
 * Правка пункта, который тем временем удалили на узле, возвращается явным конфликтом, а не пропадает молча.
 * Настройка идёт через API.
 */
async function hybridList(request: Parameters<typeof register>[0], label: string) {
  const account: Account = await register(request, label);
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const mode = await request.put(`${ws}/sync/mode`, { headers, data: { mode: "hybrid" } });
  expect(mode.status(), await mode.text()).toBe(200);
  const created = await request.post(`${ws}/lists`, { headers, data: { name: "E2E гибрид", kind: "shopping" } });
  const list = (await created.json()) as { id: string };
  await request.post(`${ws}/lists/${list.id}/items/bulk`, { headers, data: { items: [{ label: "Хлеб" }, { label: "Молоко" }] } });
  const items = async () =>
    ((await (await request.get(`${ws}/lists/${list.id}`, { headers })).json()) as { items: { id: string; label: string; checked: boolean }[] }).items;
  return { account, headers, ws, list, items };
}

test("hybrid: a list is read and edited without a connection, and the change reaches the node when it is back", async ({ page, context, request }) => {
  const { account, list, items } = await hybridList(request, "hybrid-offline");
  await signIn(page, account);
  await page.goto(`/panel/list?instance=${list.id}&workspaceId=${account.workspaceId}`);
  await expect(page.getByRole("checkbox", { name: "Хлеб" })).toBeVisible();

  // The copy is on the device now: cut the network and keep working.
  await context.setOffline(true);
  await page.getByPlaceholder(/Добавить пункт/).fill("Сыр");
  await page.getByPlaceholder(/Добавить пункт/).press("Enter");
  await expect(page.getByRole("checkbox", { name: "Сыр" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Хлеб" }).click();

  // Shown honestly: not synced, with the reason and the time of the data.
  await expect(page.getByRole("status")).toContainText(/Нет связи с узлом|В очереди/);
  await expect(page.getByText("на устройстве").or(page.getByText("в очереди")).first()).toBeVisible();
  expect((await items()).map((item) => item.label)).not.toContain("Сыр");

  // Back online: the queue drains and the node has both changes.
  await context.setOffline(false);
  await page.getByRole("button", { name: "Синхронизировать" }).click();
  await expect.poll(async () => (await items()).map((item) => item.label), { timeout: 30_000 }).toContain("Сыр");
  await expect.poll(async () => (await items()).find((item) => item.label === "Хлеб")?.checked, { timeout: 30_000 }).toBe(true);
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 30_000 });
});

test("hybrid: an edit of an entry deleted on the node meanwhile comes back as a visible conflict", async ({ page, context, request }) => {
  const { account, headers, ws, list, items } = await hybridList(request, "hybrid-conflict");
  await signIn(page, account);
  await page.goto(`/panel/list?instance=${list.id}&workspaceId=${account.workspaceId}`);
  await expect(page.getByRole("checkbox", { name: "Молоко" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("checkbox", { name: "Молоко" }).click(); // an offline edit of "Молоко"
  // Meanwhile somebody deletes that entry on the node.
  const milk = (await items()).find((item) => item.label === "Молоко");
  expect(milk).toBeDefined();
  const removed = await request.delete(`${ws}/lists/${list.id}/items/${milk?.id}`, { headers });
  expect(removed.ok()).toBe(true);

  await context.setOffline(false);
  await page.getByRole("button", { name: "Синхронизировать" }).click();
  await expect(page.getByText(/Изменение не применено: запись уже удалена на узле/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Понятно" }).click();
  await expect(page.getByText(/Изменение не применено/)).toHaveCount(0);
});

test("hybrid: access revoked on the node removes the copy on the next connection", async ({ page, request }) => {
  const { account, list } = await hybridList(request, "hybrid-revoked");
  await signIn(page, account);
  await page.goto(`/panel/list?instance=${list.id}&workspaceId=${account.workspaceId}`);
  await expect(page.getByRole("checkbox", { name: "Хлеб" })).toBeVisible();
  const stored = () => page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open("orion-replica", 1);
    open.onsuccess = () => {
      const count = open.result.transaction("replicas").objectStore("replicas").count();
      count.onsuccess = () => resolve(count.result);
    };
    open.onerror = () => resolve(-1);
  }));
  await expect.poll(stored).toBe(1);

  // The owner turns hybrid off: the device drops its copy at the next poll.
  const off = await request.put(`${apiUrl()}/workspaces/${account.workspaceId}/sync/mode`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    data: { mode: "shared" }
  });
  expect(off.status()).toBe(200);
  await page.reload();
  await expect.poll(stored, { timeout: 30_000 }).toBe(0);
});

test("hybrid: a note edited on two devices shows an explicit conflict and «Сохранить мою версию» wins on request", async ({ page, context, request }) => {
  const account: Account = await register(request, "hybrid-note");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;
  expect((await request.put(`${ws}/sync/mode`, { headers, data: { mode: "hybrid" } })).status()).toBe(200);
  const created = await request.post(`${ws}/notes`, { headers, data: { title: "Заметка E2E", body: "исходный текст" } });
  const note = (await created.json()) as { id: string; revision: number };
  const server = async () => (await (await request.get(`${ws}/notes/${note.id}`, { headers })).json()) as { title: string; body: string; revision: number };

  await signIn(page, account);
  await page.goto(`/panel/note?instance=${note.id}&workspaceId=${account.workspaceId}`);
  await expect(page.getByPlaceholder("Заголовок")).toHaveValue("Заметка E2E");

  // Device 1 (this page) edits the title without a connection...
  await context.setOffline(true);
  await page.getByPlaceholder("Заголовок").fill("Мой заголовок");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(/Нет связи с узлом|В очереди/)).toBeVisible();

  // ...while device 2 (the node's REST) changed the same note.
  const other = await request.patch(`${ws}/notes/${note.id}`, { headers, data: { body: "правка с другого ПК", expectedRevision: note.revision } });
  expect(other.ok(), await other.text()).toBe(true);

  await context.setOffline(false);
  await page.getByRole("button", { name: "Синхронизировать" }).click();
  await expect(page.getByText(/Заметку изменили на узле, пока вы были без связи/)).toBeVisible({ timeout: 30_000 });
  // No silent merge: the node still has the other device's text and the old title.
  expect(await server()).toMatchObject({ title: "Заметка E2E", body: "правка с другого ПК" });

  await page.getByRole("button", { name: "Сохранить мою версию" }).click();
  await expect.poll(async () => (await server()).title, { timeout: 30_000 }).toBe("Мой заголовок");
  await expect(page.getByText(/Заметку изменили на узле/)).toHaveCount(0);
});
