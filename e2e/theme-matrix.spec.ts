import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { ARCTIC_THEME, MIDNIGHT_THEME } from "../packages/ui/src/theme-engine";
import { apiUrl, register, signIn } from "./support";
import { seedProjects } from "./projects-seed";

/**
 * Acceptance matrix for the migrated screens (projects, tasks, notes, documents, calendar) in three
 * palettes: Precision (default), Arctic (light, saved as a personal palette) and a saved dark user palette.
 *
 * What it *measures* (written to evidence/theme-matrix/report.json): computed text contrast per screen,
 * visible focus on the first keyboard stops, an open menu, the projects error state, narrow width and
 * input kept across a width change. What it *asserts*: nothing unreadable (< 2:1), no horizontal page
 * overflow, a visible focus indicator, kept input. Contrast between 2:1 and the WCAG 4.5:1 / 3:1 targets is
 * reported, not failed: it is a finding for the next slice, not a pass.
 */
test.use({ reducedMotion: "reduce" });

const outDir = process.env.MATRIX_DIR ?? "docs/KAIDEN_ORION_REDESIGN_2026/evidence/theme-matrix";
const hour = 3_600_000;

interface Finding { text: string; ratio: number; size: number; color: string; background: string }
interface ScanResult { checked: number; belowTarget: number; below2: number; worst: Finding[] }

/** Computed-style contrast scan of visible text (ancestors' backgrounds are composited; opacity is ignored). */
async function scanContrast(page: Page): Promise<ScanResult> {
  return page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgba | null => {
      const rgb = value.match(/rgba?\(([^)]+)\)/);
      if (rgb) {
        const p = rgb[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 };
      }
      const srgb = value.match(/color\(srgb ([^)]+)\)/);
      if (srgb) {
        const p = srgb[1]!.split(/[ /]+/).filter(Boolean).map(Number);
        return { r: p[0]! * 255, g: p[1]! * 255, b: p[2]! * 255, a: p.length > 3 ? p[3]! : 1 };
      }
      return null;
    };
    const over = (top: Rgba, under: Rgba): Rgba => ({
      r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1
    });
    const lum = (c: Rgba): number => {
      const f = (n: number): number => { const v = n / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const backgroundOf = (el: Element): Rgba => {
      const chain: Rgba[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) chain.push(c);
        if (c && c.a >= 1) break;
      }
      let base: Rgba = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of chain.reverse()) base = over(layer, base);
      return base;
    };
    const results: { text: string; ratio: number; size: number; color: string; background: string }[] = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent ?? "").trim()) continue;
      seen.add(el);
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || rect.width < 2 || rect.height < 2) continue;
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
      if ((el as HTMLButtonElement).disabled || el.closest("[disabled],[aria-disabled='true']")) continue;
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = backgroundOf(el);
      const text = over(fg, bg);
      const l1 = lum(text), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      checked += 1;
      if (ratio < (large ? 3 : 4.5)) {
        results.push({ text: (n.textContent ?? "").trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, size, color: style.color, background: `rgb(${bg.r | 0} ${bg.g | 0} ${bg.b | 0})` });
      }
    }
    results.sort((a, b) => a.ratio - b.ratio);
    return { checked, belowTarget: results.length, below2: results.filter((r) => r.ratio < 2).length, worst: results.slice(0, 6) };
  });
}

/** The element focused after `presses` Tab presses must show an outline or a ring. */
async function focusIndicators(page: Page, presses: number): Promise<{ name: string; visible: boolean }[]> {
  const stops: { name: string; visible: boolean }[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { name: "(body)", visible: true };
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow !== "none" && s.boxShadow !== "";
      const parentRing = el.parentElement ? getComputedStyle(el.parentElement).boxShadow !== "none" : false;
      return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40), visible: outline || ring || parentRing };
    }));
  }
  return stops;
}

const THEMES = [
  { id: "precision", custom: null },
  { id: "arctic-saved", custom: { ...ARCTIC_THEME, id: "user-arctic", name: "Моя светлая" } },
  { id: "user-midnight", custom: { ...MIDNIGHT_THEME, id: "user-midnight", name: "Моя тёмная" } }
] as const;

const report: Record<string, unknown> = {};

for (const theme of THEMES) {
  test(`theme matrix: ${theme.id}`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const account = await register(request, `matrix-${theme.id}`);
    const seeded = await seedProjects(request, account);
    const post = async (path: string, data: unknown) => (await request.post(`${seeded.base}/${path}`, { headers: seeded.headers, data })).json();
    await post("notes", { title: "Встреча с клиентом", body: "Обсудить макеты и сроки запуска.", tags: ["сайт"], projectId: seeded.site.id });
    await post("events", { title: "Планёрка команды", startAt: new Date(Date.now() + 2 * hour).toISOString(), endAt: new Date(Date.now() + 3 * hour).toISOString(), allDay: false, reminders: [] });
    const docs = `${seeded.base}/documents`;
    await request.post(`${docs}/upload`, { headers: seeded.headers, multipart: { files: { name: "Заметки по маршруту.txt", mimeType: "text/plain", buffer: Buffer.from("День 1: Сортавала") } } });
    await request.patch(`${apiUrl()}/settings/preferences`, {
      headers: seeded.headers,
      data: theme.custom ? { theme: "kaiden-precision", customTheme: theme.custom, customThemeEnabled: true } : { theme: "kaiden-precision" }
    });
    await signIn(page, account);
    mkdirSync(outDir, { recursive: true });
    const themeReport: Record<string, unknown> = {};
    report[theme.id] = themeReport;
    const shot = async (name: string): Promise<void> => { await page.waitForTimeout(350); await page.screenshot({ path: `${outDir}/${theme.id}-${name}.png` }); };
    const verify = async (name: string): Promise<void> => {
      const scan = await scanContrast(page);
      themeReport[name] = scan;
      expect(scan.below2, `${theme.id}/${name}: unreadable text (<2:1): ${JSON.stringify(scan.worst.filter((w) => w.ratio < 2))}`).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme.id}/${name}: horizontal page overflow`).toBe(true);
    };
    const nav = (label: string | RegExp): Locator => page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: label, exact: typeof label === "string" }).first();

    // ---- wide pass
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
    const wide = (label: string | RegExp): Locator => page.getByRole("button", { name: label, exact: typeof label === "string" }).first();

    await wide("Проекты").click();
    await expect(page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true })).toBeVisible();
    await shot("projects-1600"); await verify("projects-1600");
    const focus = await focusIndicators(page, 6);
    themeReport["focus-projects"] = focus;
    expect(focus.filter((stop) => !stop.visible), `${theme.id}: focus indicator missing`).toEqual([]);

    await wide(/^Задачи/).click();
    await page.getByText("Забронировать домик у озера").first().click();
    await expect(page.getByRole("region", { name: "Детали задачи", exact: true })).toBeVisible();
    await shot("tasks-1600"); await verify("tasks-1600");
    // open menu of a task card
    await page.getByRole("button", { name: "Действия", exact: true }).first().click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await shot("tasks-menu-1600"); await verify("tasks-menu-1600");
    await page.keyboard.press("Escape");

    await wide("Заметки").click();
    await page.getByText("Встреча с клиентом").first().click();
    await expect(page.getByRole("textbox", { name: "Название заметки", exact: true })).toBeVisible();
    await shot("notes-1600"); await verify("notes-1600");

    await wide("Документы").click();
    await page.getByText("Заметки по маршруту.txt").first().click();
    await expect(page.getByText("День 1: Сортавала").first()).toBeVisible();
    await shot("documents-1600"); await verify("documents-1600");

    await wide("Календарь").click();
    const calendar = page.getByRole("group", { name: "Календарь", exact: true });
    await calendar.getByRole("tab", { name: "Месяц", exact: true }).click();
    await expect(calendar.getByRole("tab", { name: "Месяц", exact: true })).toHaveAttribute("aria-selected", "true");
    await shot("calendar-1600"); await verify("calendar-1600");

    // ---- input is kept across a width change (projects search)
    await wide("Проекты").click();
    const search = page.getByRole("textbox", { name: "Поиск проектов", exact: true });
    await search.fill("Карел");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.getByRole("textbox", { name: "Поиск проектов", exact: true })).toHaveValue("Карел");
    await search.fill("");

    // ---- error state of the projects board
    let fail = true;
    await page.route(/\/projects(\?.*)?$/, async (route) => {
      if (fail && route.request().method() === "GET") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Сервис недоступен" }) });
      else await route.continue();
    });
    await page.reload();
    await wide("Проекты").click();
    await expect(page.getByText("Не удалось загрузить проекты").first()).toBeVisible();
    await shot("projects-error-1600"); await verify("projects-error-1600");
    fail = false;
    await page.unroute(/\/projects(\?.*)?$/);

    // ---- narrow pass (view state cleared so every list is on screen)
    await page.waitForTimeout(700);
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("orion.viewState")).forEach((k) => localStorage.removeItem(k)));
    await page.setViewportSize({ width: 390, height: 844 });
    const narrowOpen = async (label: string | RegExp): Promise<void> => {
      await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
      await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
      await nav(label).click();
    };
    await narrowOpen("Проекты");
    await expect(page.getByRole("button", { name: "Открыть проект «Поездка в Карелию»", exact: true })).toBeVisible();
    await shot("projects-390"); await verify("projects-390");
    await narrowOpen(/^Задачи/);
    await expect(page.getByText("Забронировать домик у озера").first()).toBeVisible();
    await shot("tasks-390"); await verify("tasks-390");
    await narrowOpen("Заметки");
    await expect(page.getByText("Встреча с клиентом").first()).toBeVisible();
    await shot("notes-390"); await verify("notes-390");
    await narrowOpen("Документы");
    await expect(page.getByText("Заметки по маршруту.txt").first()).toBeVisible();
    await shot("documents-390"); await verify("documents-390");
    await narrowOpen("Календарь");
    await expect(page.getByRole("group", { name: "Календарь", exact: true })).toBeVisible();
    await shot("calendar-390"); await verify("calendar-390");
  });
}

test.afterAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
});
