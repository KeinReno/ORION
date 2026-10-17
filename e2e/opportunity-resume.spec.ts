import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

/**
 * R0.2: явный выбор активного резюме в расширении «Профили» — через настоящий интерфейс.
 * Данные синтетические; профиль и материалы готовятся через API, проверяется именно UI.
 */

const auth = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });
const base = (account: Account) => `${apiUrl()}/workspaces/${account.workspaceId}`;

async function enableProfiles(request: APIRequestContext, account: Account): Promise<void> {
  for (const id of ["opportunities-profiles"]) {
    const response = await request.patch(`${base(account)}/plugins/${id}`, { headers: auth(account), data: { enabled: true } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

async function seedProfile(request: APIRequestContext, account: Account, resumes: number) {
  const created = await request.post(`${base(account)}/opportunity-profiles`, {
    headers: auth(account),
    data: { displayName: "Синтетический кандидат", kind: "person", acknowledgeWorkspaceVisibility: true }
  });
  expect(created.status(), await created.text()).toBe(201);
  const profile = (await created.json()) as { id: string };
  const ids: string[] = [];
  for (let i = 1; i <= resumes; i += 1) {
    const response = await request.post(`${base(account)}/opportunity-profiles/${profile.id}/materials`, {
      headers: auth(account),
      data: { title: `Резюме v${String(i).padStart(2, "0")}`, type: "resume", content: `Синтетический текст резюме ${i}` }
    });
    expect(response.status(), await response.text()).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  return { profileId: profile.id, materialIds: ids };
}

async function openProfiles(page: Page, account: Account): Promise<void> {
  await page.goto(`/panel/opportunities?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Профили" }).click();
  await page.getByRole("button", { name: "Синтетический кандидат" }).first().click();
  await expect(page.getByRole("region", { name: "Активное резюме" })).toBeVisible();
}

const activeSection = (page: Page) => page.getByRole("region", { name: "Активное резюме" });

test("owner selects, switches and clears the active resume; selection survives reload and import of a new version", async ({ page, request }) => {
  const account = await register(request, "resume-owner");
  await enableProfiles(request, account);
  const { profileId } = await seedProfile(request, account, 3);
  await signIn(page, account);
  await openProfiles(page, account);

  await expect(activeSection(page).getByText("Пока не выбрано")).toBeVisible();
  await page.getByRole("button", { name: "Выбрать активным резюме «Резюме v01»" }).click();
  await expect(activeSection(page).getByText("Резюме v01", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Выбрать активным резюме «Резюме v02»" }).click();
  await expect(activeSection(page).getByText("Резюме v02", { exact: true })).toBeVisible();

  // reload keeps the choice
  await page.reload();
  await page.getByRole("button", { name: "Профили" }).click();
  await page.getByRole("button", { name: "Синтетический кандидат" }).first().click();
  await expect(activeSection(page).getByText("Резюме v02", { exact: true })).toBeVisible();

  // a new version added afterwards does not switch the choice
  const add = await request.post(`${base(account)}/opportunity-profiles/${profileId}/materials`, {
    headers: auth(account),
    data: { title: "Резюме v99", type: "resume", content: "Новая версия" }
  });
  expect(add.status()).toBe(201);
  await activeSection(page).getByRole("button", { name: "Обновить профиль" }).click();
  await expect(activeSection(page).getByText("Резюме v02", { exact: true })).toBeVisible();

  // view the active version
  await activeSection(page).getByRole("button", { name: "Открыть активное резюме" }).click();
  await expect(page.getByText("Синтетический текст резюме 2")).toBeVisible();

  // clear without deleting materials
  await activeSection(page).getByRole("button", { name: "Снять выбор резюме" }).click();
  await expect(activeSection(page).getByText("Пока не выбрано")).toBeVisible();
  await expect(page.getByRole("button", { name: "Выбрать активным резюме «Резюме v01»" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Резюме v03", exact: true })).toBeVisible();
});

test("active resume beyond the first page of materials stays visible and openable", async ({ page, request }) => {
  const account = await register(request, "resume-page");
  await enableProfiles(request, account);
  const { profileId } = await seedProfile(request, account, 55);
  const materialsUrl = `${base(account)}/opportunity-profiles/${profileId}/materials`;
  const first = (await (await request.get(materialsUrl, { headers: auth(account) })).json()) as { items: { id: string }[]; nextCursor: string | null };
  expect(first.items).toHaveLength(50);
  const second = (await (await request.get(`${materialsUrl}?cursor=${first.nextCursor}`, { headers: auth(account) })).json()) as { items: { id: string; title: string }[] };
  expect(second.items.length).toBeGreaterThan(0);
  const target = second.items[0]; // deterministically beyond the first page, whatever the page order is
  const detail = (await (await request.get(`${base(account)}/opportunity-profiles/${profileId}`, { headers: auth(account) })).json()) as { revision: number };
  const select = await request.post(`${base(account)}/opportunity-profiles/${profileId}/active-resume`, {
    headers: auth(account),
    data: { expectedRevision: detail.revision, materialId: target.id }
  });
  expect(select.ok(), await select.text()).toBe(true);
  await signIn(page, account);
  await openProfiles(page, account);
  await expect(activeSection(page).getByText(target.title, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: target.title, exact: true })).toHaveCount(0);
  await activeSection(page).getByRole("button", { name: "Открыть активное резюме" }).click();
  await expect(page.getByText(`Синтетический текст резюме ${Number(target.title.slice(-2))}`)).toBeVisible();
});

test("a stale window cannot silently overwrite the selection; an unsaved form blocks selection", async ({ page, browser, request }) => {
  const account = await register(request, "resume-conflict");
  await enableProfiles(request, account);
  await seedProfile(request, account, 2);
  await signIn(page, account);
  await openProfiles(page, account);

  const second = await browser.newContext({ locale: "ru-RU" });
  const other = await second.newPage();
  await signIn(other, account);
  await openProfiles(other, account);

  await page.getByRole("button", { name: "Выбрать активным резюме «Резюме v01»" }).click();
  await expect(activeSection(page).getByText("Резюме v01", { exact: true })).toBeVisible();

  // the second window still has the old revision
  await other.getByRole("button", { name: "Выбрать активным резюме «Резюме v02»" }).click();
  await expect(other.getByRole("alert").filter({ hasText: "Профиль изменён в другом окне" })).toBeVisible();
  await other.getByRole("button", { name: "Обновить профиль" }).click();
  await expect(activeSection(other).getByText("Резюме v01", { exact: true })).toBeVisible();
  await second.close();

  // unsaved form: typing into the material form disables selection
  await page.getByLabel("Название").first().fill("Черновик версии");
  await expect(page.getByRole("button", { name: "Выбрать активным резюме «Резюме v02»" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Снять выбор резюме" })).toBeDisabled();
  await expect(page.getByText("Сохраните или отмените изменения формы перед выбором резюме.")).toBeVisible();
});

test("a member without owner rights sees the choice but cannot change it; an archived profile is read-only", async ({ page, request }) => {
  const owner = await register(request, "resume-own2");
  const member = await register(request, "resume-mem2");
  await enableProfiles(request, owner);
  const { profileId, materialIds } = await seedProfile(request, owner, 2);
  const me = (await (await request.get(`${apiUrl()}/auth/me`, { headers: auth(member) })).json()) as { email: string };
  const invite = await request.post(`${base(owner)}/invites`, { headers: auth(owner), data: { email: me.email, role: "member" } });
  expect(invite.status(), await invite.text()).toBe(201);
  const { code } = (await invite.json()) as { code: string };
  const accepted = await request.post(`${apiUrl()}/invites/${code}/accept`, { headers: auth(member) });
  expect(accepted.ok(), await accepted.text()).toBe(true);

  const detail = (await (await request.get(`${base(owner)}/opportunity-profiles/${profileId}`, { headers: auth(owner) })).json()) as { revision: number };
  const sel = await request.post(`${base(owner)}/opportunity-profiles/${profileId}/active-resume`, {
    headers: auth(owner),
    data: { expectedRevision: detail.revision, materialId: materialIds[0] }
  });
  expect(sel.ok()).toBe(true);

  await signIn(page, { ...member, workspaceId: owner.workspaceId });
  await openProfiles(page, { ...member, workspaceId: owner.workspaceId });
  await expect(activeSection(page).getByText("Резюме v01", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Выбрать активным резюме/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Снять выбор резюме" })).toHaveCount(0);

  // archive as owner through the API: the owner's view loses the controls too
  const fresh = (await (await request.get(`${base(owner)}/opportunity-profiles/${profileId}`, { headers: auth(owner) })).json()) as { revision: number };
  const archived = await request.patch(`${base(owner)}/opportunity-profiles/${profileId}`, {
    headers: auth(owner),
    data: { expectedRevision: fresh.revision, archivedAt: new Date().toISOString() }
  });
  expect(archived.ok(), await archived.text()).toBe(true);
  const rejected = await request.post(`${base(owner)}/opportunity-profiles/${profileId}/active-resume`, {
    headers: auth(owner),
    data: { expectedRevision: fresh.revision + 1, materialId: materialIds[1] }
  });
  expect(rejected.status()).toBeGreaterThanOrEqual(400);
});

test("narrow screen: no horizontal overflow, controls reachable by keyboard", async ({ page, request }) => {
  const account = await register(request, "resume-mobile");
  await enableProfiles(request, account);
  await seedProfile(request, account, 2);
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, account);
  await openProfiles(page, account);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const button = page.getByRole("button", { name: "Выбрать активным резюме «Резюме v01»" });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(activeSection(page).getByText("Резюме v01", { exact: true })).toBeVisible();
});
