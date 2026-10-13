import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Browser smoke + parity baseline for every navigable panel
 * (docs/AI_REFACTOR_MIGRATION_MAP.md §3 "Сначала baseline": screenshots,
 * available actions and tabs, smoke scenarios, default-full and
 * plugins-off profiles).
 *
 * Each panel opens on its own through `/panel/<id>?workspaceId=…` — the same
 * route a detached window uses — so the check does not depend on a saved dock
 * layout. Two fresh accounts are registered through the API:
 *   - `default-full`: the workspace exactly as registration creates it;
 *   - `plugins-off`:  the same, with every optional plugin switched off.
 * For each panel the test asserts that it renders without a page error and
 * records its *action inventory* (visible tab and button names, numbers
 * masked) as a text snapshot. A plugin extraction or redesign that silently
 * drops or adds an action changes that snapshot — review the diff, then
 * refresh with `pnpm test:e2e:local --update-snapshots`. A full-page
 * screenshot of each panel is attached to the report as visual evidence (not
 * compared pixel-by-pixel: fonts differ between Windows and the Linux runner).
 */

// Panels a user reaches from the sidebar. Markets is disabled by default and
// needs the external Compass engine, so it is not part of the baseline.
const PANELS = [
  "dashboard",
  "inbox",
  "overview",
  "shared",
  "tasks",
  "calendar",
  "notes",
  "projects",
  "goals",
  "home",
  "time",
  "habits",
  "lists",
  "finance",
  "inventory",
  "documents",
  "sync",
  "settings",
  "browser"
] as const;

interface Account {
  accessToken: string;
  refreshToken: string;
  workspaceId: string;
}

const PROFILES = ["default-full", "plugins-off"] as const;
type Profile = (typeof PROFILES)[number];
const accounts = new Map<Profile, Account>();

function apiUrl(): string {
  return `http://localhost:${process.env.E2E_API_PORT ?? 4000}`;
}

async function register(request: APIRequestContext, label: string): Promise<Account> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await request.post(`${apiUrl()}/auth/register`, {
    data: { name: `E2E ${label}`, email: `e2e-${label}-${stamp}@example.test`, password: "e2e-Strong-Password-42" }
  });
  expect(response.status(), await response.text()).toBe(201);
  const auth = (await response.json()) as { accessToken: string; refreshToken: string };
  const spaces = await request.get(`${apiUrl()}/workspaces/me`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
  expect(spaces.ok()).toBe(true);
  const list = (await spaces.json()) as { id: string }[];
  expect(list.length).toBeGreaterThan(0);
  return { accessToken: auth.accessToken, refreshToken: auth.refreshToken, workspaceId: list[0].id };
}

async function disableAllPlugins(request: APIRequestContext, account: Account): Promise<void> {
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const states = (await (await request.get(`${apiUrl()}/workspaces/${account.workspaceId}/plugins`, { headers })).json()) as {
    id: string;
    enabled: boolean;
  }[];
  for (const plugin of states.filter((state) => state.enabled)) {
    const response = await request.patch(`${apiUrl()}/workspaces/${account.workspaceId}/plugins/${plugin.id}`, {
      headers,
      data: { enabled: false }
    });
    expect(response.ok(), `disable ${plugin.id}: ${await response.text()}`).toBe(true);
  }
}

async function signIn(page: Page, account: Account): Promise<void> {
  await page.addInitScript((tokens) => {
    window.localStorage.setItem("orion.auth.accessToken", tokens.accessToken);
    window.localStorage.setItem("orion.auth.refreshToken", tokens.refreshToken);
  }, account);
}

/**
 * Names of the visible tabs and buttons, one per line. Digits are masked so
 * dates, counters and clock times do not churn the baseline; month and
 * weekday names (calendar headers) are masked for the same reason.
 */
async function actionInventory(page: Page): Promise<string> {
  const names = await page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const box = (element as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const label = (element: Element): string =>
      (element.getAttribute("aria-label") || element.getAttribute("title") || (element as HTMLElement).innerText || "").trim();
    const out: string[] = [];
    for (const element of Array.from(document.querySelectorAll('[role="tab"], button, [role="button"]'))) {
      if (!visible(element)) continue;
      const kind = element.getAttribute("role") === "tab" ? "tab" : "button";
      const text = label(element).replace(/\s+/g, " ");
      if (text) out.push(`${kind}: ${text}`);
    }
    return out;
  });
  const months =
    /(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*|\b(янв|фев|мар|апр|июн|июл|авг|сен|окт|ноя|дек)\b\.?/giu;
  const weekdays = /\b(понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье|пн|вт|ср|чт|пт|сб|вс)\b/giu;
  const normalized = names.map((line) =>
    line
      .replace(/\d+/g, "#")
      .replace(months, "<month>")
      .replace(weekdays, "<weekday>")
      .slice(0, 120)
  );
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b, "ru")).join("\n") + "\n";
}

test.beforeAll(async ({ request }) => {
  accounts.set("default-full", await register(request, "full"));
  const off = await register(request, "off");
  await disableAllPlugins(request, off);
  accounts.set("plugins-off", off);
});

for (const profile of PROFILES) {
  test.describe(profile, () => {
    for (const panelId of PANELS) {
      test(`${panelId} renders and keeps its actions`, async ({ page }, testInfo) => {
        const account = accounts.get(profile);
        if (!account) throw new Error(`no account for ${profile}`);
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await signIn(page, account);

        await page.goto(`/panel/${panelId}?workspaceId=${account.workspaceId}`);
        await expect(page).toHaveURL(new RegExp(`/panel/${panelId}`));
        // PanelWindow shows "Загрузка…" until session and workspace resolve,
        // then mounts the (lazy) panel; wait for that and for the network.
        await expect(page.getByText("Загрузка…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
        await expect(page.getByText("Не удаётся связаться с сервером.")).toHaveCount(0);
        await expect(page.getByText(/Неизвестная панель/)).toHaveCount(0);

        expect(pageErrors, `page errors in ${panelId}`).toEqual([]);
        const body = (await page.locator("body").innerText()).trim();
        expect(body.length, `${panelId} rendered an empty page`).toBeGreaterThan(20);

        await testInfo.attach(`${profile}-${panelId}.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png"
        });
        expect(await actionInventory(page)).toMatchSnapshot(`${profile}-${panelId}.txt`);
      });
    }
  });
}
