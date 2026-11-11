import { expect, type Page, test } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

async function openWorkbench(page: Page, account: Account): Promise<void> {
  await signIn(page, account);
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  const create = page.getByRole("button", { name: "Создать второй сайдбар" });
  const openSpace = page.getByRole("button", { name: /Открыть$/ });
  await expect(create.or(openSpace)).toBeVisible();
  if (await openSpace.isVisible()) await openSpace.click();
  await expect(create).toBeVisible();
}

test("equal sidebars keep shortcuts, folders, and an open editor apart from the dock", async ({ page, request, browser }) => {
  const account = await register(request, "nav-sidebars");
  const me = await request.get(`${apiUrl()}/auth/me`, { headers: { Authorization: `Bearer ${account.accessToken}` } });
  expect(me.ok()).toBe(true);
  const user = (await me.json()) as { id: string };
  const storageKey = `orion.navSidebars.v2.${user.id}.${account.workspaceId}`;

  await openWorkbench(page, account);
  await page.getByRole("button", { name: "Создать второй сайдбар" }).click();
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  await expect(page.locator(".dv-tab", { hasText: "Заметки" })).toHaveCount(1);

  await page.getByRole("button", { name: "Заметки", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Переместить в сайдбар «Второй»" }).click();
  await expect(page.locator(".dv-tab", { hasText: "Заметки" })).toHaveCount(1);
  await expect(page.locator(".dv-tab", { hasText: "Дашборд" })).toHaveCount(1);

  const primaryNav = page.getByRole("navigation", { name: "Разделы" }).first();
  await page.getByRole("button", { name: "Новая папка", exact: true }).click();
  await page.getByRole("textbox", { name: "Название папки" }).fill("Дом");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(primaryNav.getByRole("button", { name: "Папка «Дом», разделов: 0", exact: true })).toBeVisible();
  const secondNav = page.getByRole("navigation", { name: "Разделы" }).nth(1);
  await page.evaluate(() => {
    const source = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Инбокс");
    const target = document.querySelectorAll("nav[aria-label='Разделы']")[1];
    if (!source || !target) throw new Error("drag endpoints missing");
    const data = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(secondNav.getByRole("button", { name: "Инбокс", exact: true })).toBeVisible();
  await expect(page.locator(".dv-tab", { hasText: "Заметки" })).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole("button", { name: "Создать третий сайдбар" })).toBeVisible();
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(stored).toContain("side-2");
  expect(stored).toContain("Дом");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), "orion.navSidebars.v1")).toBeNull();
  await expect(page.locator(".dv-tab", { hasText: "Заметки" })).toHaveCount(1);

  const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const otherPage = await other.newPage();
  const second = await register(request, "nav-sidebars-other");
  await openWorkbench(otherPage, second);
  const leaked = await otherPage.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("orion.navSidebars.v2.")));
  expect(leaked.some((key) => key.includes(account.workspaceId))).toBe(false);
  await other.close();
});

test("built-in folders stay editable, removable, and genuinely ungrouped after reload", async ({ page, request }) => {
  const account = await register(request, "editable-default-folders");
  const me = await request.get(`${apiUrl()}/auth/me`, { headers: { Authorization: `Bearer ${account.accessToken}` } });
  const user = (await me.json()) as { id: string };
  const storageKey = `orion.navSidebars.v2.${user.id}.${account.workspaceId}`;

  await openWorkbench(page, account);
  const primaryNav = page.getByRole("navigation", { name: "Разделы" }).first();
  const workFolder = primaryNav.getByRole("button", { name: /^Папка «Работа», разделов: \d+$/ });
  await expect(workFolder).toBeVisible();
  await primaryNav.getByRole("button", { name: "Действия с папкой «Работа»", exact: true }).click();
  await page.getByRole("menuitem", { name: "Переименовать…" }).click();
  await page.getByRole("textbox", { name: "Название папки" }).fill("Мои проекты");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const renamedFolder = primaryNav.getByRole("button", { name: /^Папка «Мои проекты», разделов: \d+$/ });
  const renamedMenu = primaryNav.getByRole("button", { name: "Действия с папкой «Мои проекты»", exact: true });
  await expect(renamedFolder).toBeVisible();

  await primaryNav.getByRole("button", { name: "Заметки", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Убрать из папки" }).click();
  const ungrouped = await page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) ?? "{}") as {
      sidebars?: { order?: string[]; defaultFoldersSeeded?: boolean }[];
    };
    return { order: state.sidebars?.[0]?.order, seeded: state.sidebars?.[0]?.defaultFoldersSeeded };
  }, storageKey);
  expect(ungrouped.order).toContain("notes");
  expect(ungrouped.seeded).toBe(true);

  await renamedMenu.click();
  await page.getByRole("menuitem", { name: "Удалить папку" }).click();
  await expect(renamedFolder).toHaveCount(0);
  await expect(primaryNav.getByRole("button", { name: "Задачи", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(renamedFolder).toBeVisible();

  await renamedMenu.click();
  await page.getByRole("menuitem", { name: "Удалить папку" }).click();
  await page.reload();
  await expect(primaryNav.getByRole("button", { name: /^Папка «Мои проекты», разделов: \d+$/ })).toHaveCount(0);
  await expect(primaryNav.getByRole("button", { name: "Заметки", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("button", { name: "Задачи", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("button", { name: "Новая папка", exact: true })).toBeVisible();
});

test("a detached sidebar returns when its window closes and does not open a second editor", async ({ page, request }) => {
  const account = await register(request, "nav-window");
  await openWorkbench(page, account);
  await page.getByRole("button", { name: "Создать второй сайдбар" }).click();
  const primaryNav = page.getByRole("navigation", { name: "Разделы" }).first();
  await primaryNav.getByRole("button", { name: "Заметки", exact: true }).click();
  await primaryNav.getByRole("button", { name: "Заметки", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Переместить в сайдбар «Второй»" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "В отдельное окно" }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("navigation", { name: "Разделы" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Разделы" })).toHaveCount(1);
  await popup.getByRole("button", { name: "Заметки", exact: true }).click();
  await expect(page.locator(".dv-tab", { hasText: "Заметки" })).toHaveCount(1);
  await popup.close();
  await expect(page.getByRole("navigation", { name: "Разделы" })).toHaveCount(2);
});

test("folder controls respect reduced motion and stay usable on a phone", async ({ page, request }) => {
  const account = await register(request, "nav-reduced-motion");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, account);
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  const drawer = page.getByRole("navigation", { name: "Разделы" });
  const workFolder = drawer.getByRole("button", { name: /^Папка «Работа», разделов: \d+$/ });
  await expect(workFolder).toBeVisible();
  await workFolder.click();
  await expect(workFolder).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => drawer.evaluate((nav) => nav.getAnimations({ subtree: true }).length)).toBe(0);
  await workFolder.click();
  await expect(workFolder).toHaveAttribute("aria-expanded", "true");
  await drawer.getByRole("button", { name: "Действия с папкой «Работа»", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Переименовать…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Переименовать…" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const size of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  test(`workbench stays clear of three bars at ${size.width}x${size.height}`, async ({ page, request }) => {
    const account = await register(request, `nav-${size.width}`);
    await page.setViewportSize(size);
    await openWorkbench(page, account);
    await page.getByRole("button", { name: "Создать второй сайдбар" }).click();
    await page.getByRole("button", { name: "Создать третий сайдбар" }).click();
    const box = await page.locator("#orion-workbench").boundingBox();
    expect(box && box.width).toBeGreaterThan(320);
    expect(box && box.height).toBeGreaterThan(200);
    const overlap = await page.evaluate(() => {
      const work = document.getElementById("orion-workbench")!.getBoundingClientRect();
      return [...document.querySelectorAll("nav")].some((nav) => {
        const rect = nav.getBoundingClientRect();
        return rect.left < work.right - 1 && rect.right > work.left + 1 && rect.top < work.bottom - 1 && rect.bottom > work.top + 1;
      });
    });
    expect(overlap).toBe(false);
  });
}
