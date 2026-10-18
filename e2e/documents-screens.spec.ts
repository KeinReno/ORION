import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, register, signIn } from "./support";

test.use({ reducedMotion: "reduce" });

/** Screens of the Documents module on synthetic data. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/documents";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

test("documents screens: list, preview, narrow", async ({ page, request }) => {
  test.setTimeout(150_000);
  const account = await register(request, "docs-screens");
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const base = `${apiUrl()}/workspaces/${account.workspaceId}/documents`;
  const folder = await (await request.post(base, { headers, data: { name: "Договоры и счета" } })).json();
  await request.post(base, { headers, data: { name: "Фотографии с поездки" } });
  const upload = async (name: string, text: string, parentId?: string) => {
    const response = await request.post(`${base}/upload`, { headers, multipart: { ...(parentId ? { parentId } : {}), files: { name, mimeType: "text/plain", buffer: Buffer.from(text) } } });
    expect(response.ok(), await response.text()).toBe(true);
  };
  await upload("Заметки по маршруту.txt", "День 1: Сортавала\nДень 2: Валаам");
  await upload("Список снаряжения с очень длинным названием файла, которое должно аккуратно обрезаться.txt", "Палатка, спальник");
  await upload("Договор аренды.txt", "Стороны договорились.", folder.id);
  await request.patch(`${apiUrl()}/settings/preferences`, { headers, data: { theme: "kaiden-precision" } });
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await expect(page.getByText("Заметки по маршруту.txt").first()).toBeVisible();
  await shot(page, "list-1600");
  await page.getByText("Заметки по маршруту.txt").first().click();
  await expect(page.getByText("День 2: Валаам").first()).toBeVisible();
  await shot(page, "preview-1600");
  // Links, reminders and sharing stay one click away behind the disclosure.
  await page.locator("summary").filter({ hasText: "Связи, напоминания и доступ" }).click();
  await expect(page.getByText("Связанные записи").first()).toBeVisible();
  await expect(page.getByText("Доступ извне").first()).toBeVisible();
  await page.locator("summary").filter({ hasText: "Связи, напоминания и доступ" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "preview-390");
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  // The reload restores the open file; on a phone its preview sheet covers the menu, so close it first.
  const restored = page.getByRole("dialog").filter({ hasText: "День 2: Валаам" });
  await restored.waitFor({ state: "visible", timeout: 3000 }).then(() => page.keyboard.press("Escape"), () => undefined);
  await expect(restored).toBeHidden();
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: "Документы", exact: true }).click();
  await page.waitForTimeout(1500);
  const back = page.getByRole("button", { name: /К файлам|Назад к списку|Файлы/ });
  if (await back.count()) await back.first().click();
  await expect(page.getByText("Фотографии с поездки").first()).toBeVisible();
  await shot(page, "list-390");
});

test("documents screens: empty workspace", async ({ page, request }) => {
  const account = await register(request, "docs-empty");
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await page.waitForTimeout(800);
  await shot(page, "empty-1600");
});
