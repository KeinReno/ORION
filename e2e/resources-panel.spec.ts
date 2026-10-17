import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiUrl, disableAllPlugins, register, signIn, type Account } from "./support";

/**
 * ADR-0014 / TZ-01 — the right-hand context panel «Ресурсы / Связи / Свойства» through the real shell:
 *   Финансы → счёт → файл → открепить (файл остаётся), Проект → материалы → задача,
 *   выключенные плагины → «Ресурсы недоступны», узкий экран без горизонтальной прокрутки.
 * Setup goes through the API.
 */

function headers(account: Account): Record<string, string> {
  return { Authorization: `Bearer ${account.accessToken}` };
}

async function upload(request: APIRequestContext, account: Account, name: string): Promise<string> {
  const response = await request.post(`${apiUrl()}/workspaces/${account.workspaceId}/documents/upload`, {
    headers: headers(account),
    multipart: { files: { name, mimeType: "text/plain", buffer: Buffer.from(`содержимое ${name}`) } }
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }[])[0].id;
}

async function openSection(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: label, exact: true }).click();
}

const panel = (page: Page) => page.getByRole("complementary", { name: /Контекстная панель/ });

test("Финансы → счёт → файл: связать, предпросмотр, открепить (файл остаётся)", async ({ page, request }) => {
  const account = await register(request, "ctxfin");
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const created = await request.post(`${ws}/finance/accounts`, { headers: headers(account), data: { name: "Сбер E2E", kind: "cash", currency: "RUB" } });
  expect(created.status(), await created.text()).toBe(201);
  await upload(request, account, "Договор-e2e.txt");
  await upload(request, account, "Выписка-e2e.txt");

  await signIn(page, account);
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  // Closed by default: it takes no width from someone who does not use it.
  await expect(panel(page)).toHaveCount(0);

  await openSection(page, "Финансы");
  await page.getByRole("tab", { name: "Счета" }).click();
  const card = page.locator("div", { hasText: "Сбер E2E" }).filter({ has: page.getByRole("button", { name: "Действия" }) }).last();
  await card.getByRole("button", { name: "Действия" }).click();
  await page.getByRole("menuitem", { name: "Файлы и связи" }).click();

  // The header always names the context.
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Сбер E2E" })).toBeVisible();
  await expect(panel(page).getByText("Финансы", { exact: true })).toBeVisible();
  await expect(panel(page).getByText("Файлов пока нет")).toBeVisible();

  // Link an existing file.
  await panel(page).getByRole("button", { name: "Связать", exact: true }).click();
  await panel(page).getByRole("button", { name: "Связать «Договор-e2e.txt»" }).click();
  await panel(page).getByRole("button", { name: "Готово" }).click();
  await expect(panel(page).getByRole("button", { name: "Предпросмотр «Договор-e2e.txt»" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: /Предпросмотр «Выписка/ })).toHaveCount(0);

  // The same file also hangs on a second object — no copy of the bytes.
  const projects = await request.post(`${ws}/projects`, { headers: headers(account), data: { name: "Проект E2E" } });
  expect(projects.status(), await projects.text()).toBe(201);
  const docs = (await (await request.get(`${ws}/documents`, { headers: headers(account) })).json()) as { id: string; name: string; checksum: string | null }[];
  const contract = docs.find((doc) => doc.name === "Договор-e2e.txt");
  expect(contract).toBeTruthy();
  const project = (await projects.json()) as { id: string };
  const link = await request.post(`${ws}/links`, {
    headers: headers(account),
    data: { sourceType: "document", sourceId: contract!.id, targetType: "project", targetId: project.id, kind: "related_to", label: null }
  });
  expect(link.status(), await link.text()).toBe(201);

  // Preview opens in a dialog, never replacing the editor of «Документы».
  await panel(page).getByRole("button", { name: "Предпросмотр «Договор-e2e.txt»" }).click();
  await expect(page.getByRole("dialog", { name: "Договор-e2e.txt" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Properties and links tabs follow the same object.
  await panel(page).getByRole("tab", { name: "Свойства" }).click();
  await expect(panel(page).getByText("счёт", { exact: true })).toBeVisible();
  await panel(page).getByRole("tab", { name: "Связи" }).click();
  await expect(panel(page).getByText("Договор-e2e.txt")).toBeVisible();
  await panel(page).getByRole("tab", { name: "Ресурсы" }).click();

  // Unlink asks first; the file is not deleted.
  await panel(page).getByRole("button", { name: "Открепить «Договор-e2e.txt»" }).click();
  await expect(page.getByRole("dialog", { name: "Открепить файл?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Открепить файл?" }).getByRole("button", { name: "Открепить" }).click();
  await expect(panel(page).getByText("Файлов пока нет")).toBeVisible();
  const after = (await (await request.get(`${ws}/documents`, { headers: headers(account) })).json()) as { name: string }[];
  expect(after.map((doc) => doc.name)).toContain("Договор-e2e.txt");
  const stillOnProject = (await (await request.get(`${ws}/links?type=project&id=${project.id}`, { headers: headers(account) })).json()) as { items: unknown[] };
  expect(stillOnProject.items).toHaveLength(1);

  // Hiding the panel gives the width back; the keyboard reaches it too.
  await page.getByRole("button", { name: "Скрыть панель" }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press("Alt+r");
  await expect(panel(page)).toBeVisible();
});

test("Проект → материалы → задача: файл как материал задачи", async ({ page, request }) => {
  const account = await register(request, "ctxproj");
  const ws = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const project = (await (await request.post(`${ws}/projects`, { headers: headers(account), data: { name: "Ремонт E2E" } })).json()) as { id: string };
  const task = (await (await request.post(`${ws}/tasks`, { headers: headers(account), data: { title: "Купить плитку", projectId: project.id } })).json()) as { id: string };
  await upload(request, account, "Смета-e2e.txt");

  await signIn(page, account);
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await openSection(page, "Задачи");
  await page.getByText("Купить плитку", { exact: true }).first().click();
  await page.keyboard.press("Alt+r");

  await expect(panel(page).getByRole("heading", { name: "Купить плитку" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Связать", exact: true }).click();
  await panel(page).getByRole("button", { name: "Связать «Смета-e2e.txt»" }).click();
  await panel(page).getByRole("button", { name: "Готово" }).click();
  await expect(panel(page).getByRole("button", { name: "Предпросмотр «Смета-e2e.txt»" })).toBeVisible();

  // Stored as a typed relation: the file is «материал для» the task, not a copy.
  const links = (await (await request.get(`${ws}/links?type=task&id=${task.id}`, { headers: headers(account) })).json()) as { items: { kind: string; sourceType: string }[] };
  expect(links.items).toEqual([expect.objectContaining({ kind: "supports", sourceType: "document" })]);

  // Pinning keeps these files while another section is open; «следовать» releases it.
  await panel(page).getByRole("button", { name: "Закрепить контекст" }).click();
  await openSection(page, "Календарь");
  await expect(panel(page).getByRole("heading", { name: "Купить плитку" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Следовать за текущим объектом" }).click();
  await expect(panel(page).getByRole("heading", { name: "Календарь" })).toBeVisible();
});

test("плагины выключены: вкладка «Ресурсы» говорит «недоступно», остальное работает", async ({ page, request }) => {
  const account = await register(request, "ctxoff");
  await disableAllPlugins(request, account);
  await signIn(page, account);
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await openSection(page, "Задачи");
  await page.keyboard.press("Alt+r");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("Ресурсы недоступны")).toBeVisible();
  await panel(page).getByRole("tab", { name: "Свойства" }).click();
  await expect(panel(page).getByRole("tabpanel").getByText("Раздел", { exact: true })).toBeVisible();
});

test("узкий экран: шторка без горизонтальной прокрутки", async ({ page, request }) => {
  const account = await register(request, "ctxnarrow");
  await upload(request, account, "Длинное-имя-файла-для-проверки-переноса-в-узкой-панели-e2e.txt");
  await signIn(page, account);
  for (const width of [320, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    await page.getByRole("button", { name: "Контекстная панель: ресурсы, связи, свойства" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Ресурсы" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal scroll at ${width}px`).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
  }
});
