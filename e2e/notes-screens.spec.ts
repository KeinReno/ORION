import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiUrl, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

test.use({ reducedMotion: "reduce" });

/** Screens of the Notes module on synthetic data. `SHOT_DIR` selects before/after evidence. */
const shotDir = process.env.SHOT_DIR ?? "tmp/redesign/notes";
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotDir, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/${name}.png` });
}

test("notes screens: list, editor, narrow", async ({ page, request }) => {
  test.setTimeout(150_000);
  const account = await register(request, "notes-screens");
  const seeded = await seedProjects(request, account);
  const post = async (data: unknown) => (await request.post(`${seeded.base}/notes`, { headers: seeded.headers, data })).json();
  await post({ title: "Идеи для главной страницы с очень длинным названием, которое должно аккуратно обрезаться в списке", body: "# Идеи\n\n- крупный заголовок\n- сетка кейсов\n\nТекст заметки, который показывается во фрагменте списка.", tags: ["сайт", "идеи"], projectId: seeded.site.id });
  await post({ title: "Список покупок", body: "Молоко, хлеб, сыр", tags: ["дом"] });
  await post({ title: "Встреча с клиентом", body: "Обсудить макеты и сроки запуска.", tags: ["сайт"], projectId: seeded.site.id });
  await request.patch(`${apiUrl()}/settings/preferences`, { headers: seeded.headers, data: { theme: "kaiden-precision" } });
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await expect(page.getByText("Список покупок").first()).toBeVisible();
  await shot(page, "list-1600");
  await page.getByText("Встреча с клиентом").first().click();
  await expect(page.getByRole("textbox", { name: "Название заметки", exact: true })).toBeVisible();
  await shot(page, "editor-1600");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "editor-390");
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: "Заметки", exact: true }).click();
  // The last open note is restored (stage 20): on a narrow panel it replaces the list until "К заметкам".
  const back = page.getByRole("button", { name: "К заметкам", exact: true });
  await page.waitForTimeout(1500);
  if (await back.count()) await back.click();
  await expect(page.getByText("Список покупок").first()).toBeVisible();
  await shot(page, "list-390");
});

test("notes screens: empty workspace", async ({ page, request }) => {
  const account = await register(request, "notes-empty");
  await signIn(page, account);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await page.waitForTimeout(800);
  await shot(page, "empty-1600");
});
