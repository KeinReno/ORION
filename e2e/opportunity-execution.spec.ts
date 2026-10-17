import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

/**
 * R1.1 через интерфейс. Локальный исполнитель ИМИТИРУЕТСЯ вызовами протокола opportunities-executor/v1 — это проверка
 * серверного протокола и экранов, а не отправки на настоящий hh.ru.
 */

const auth = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });
const base = (account: Account) => `${apiUrl()}/workspaces/${account.workspaceId}`;
const RUNNER = `${apiUrl()}/opportunities-executor/v1`;

async function seed(request: APIRequestContext, account: Account, externalId = "7770001") {
  for (const id of ["opportunities-profiles", "opportunities-assistant", "opportunities-execution"]) expect((await request.patch(`${base(account)}/plugins/${id}`, { headers: auth(account), data: { enabled: true } })).ok()).toBe(true);
  const opp = (await (await request.post(`${base(account)}/opportunities`, { headers: auth(account), data: { kind: "job", title: `Бизнес-аналитик ${externalId}`, organizationName: "Синтетик", description: "Требования:\n- Опыт написания SQL запросов", sourceType: "hh", externalId, canonicalUrl: `https://hh.ru/vacancy/${externalId}`, conditions: { workFormat: "remote", amountMin: 150000, amountMax: 200000, paymentBasis: "monthly", taxBasis: "net" } } })).json()) as { id: string };
  const profile = (await (await request.post(`${base(account)}/opportunity-profiles`, { headers: auth(account), data: { displayName: "Синтетический Кандидат", kind: "person", acknowledgeWorkspaceVisibility: true } })).json()) as { id: string };
  const fact = (await (await request.post(`${base(account)}/opportunity-profiles/${profile.id}/facts`, { headers: auth(account), data: { statement: "Писал SQL запросы для отчётности", source: "синтетическая заметка" } })).json()) as { id: string; revision: number };
  await request.patch(`${base(account)}/opportunity-profiles/${profile.id}/facts/${fact.id}`, { headers: auth(account), data: { expectedRevision: fact.revision, state: "confirmed" } });
  const resume = (await (await request.post(`${base(account)}/opportunity-profiles/${profile.id}/materials`, { headers: auth(account), data: { title: "Резюме v1", type: "resume", content: "SQL" } })).json()) as { id: string };
  const detail = (await (await request.get(`${base(account)}/opportunity-profiles/${profile.id}`, { headers: auth(account) })).json()) as { revision: number };
  await request.post(`${base(account)}/opportunity-profiles/${profile.id}/active-resume`, { headers: auth(account), data: { expectedRevision: detail.revision, materialId: resume.id } });
  const draft = (await (await request.post(`${base(account)}/opportunity-assistant/drafts`, { headers: auth(account), data: { opportunityId: opp.id, profileId: profile.id, kind: "response" } })).json()) as { id: string; revision: number; textHash: string };
  const approved = await request.post(`${base(account)}/opportunity-assistant/drafts/${draft.id}/approve`, { headers: auth(account), data: { expectedRevision: draft.revision, textHash: draft.textHash } });
  expect(approved.status(), await approved.text()).toBe(201);
  return { externalId, profileId: profile.id };
}

async function openExecution(page: Page, account: Account): Promise<void> {
  await page.goto(`/panel/opportunities?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Отправка" }).click();
  await expect(page.getByRole("region", { name: "Подключения HH" })).toBeVisible();
}

const post = async (request: APIRequestContext, token: string, path: string, data?: unknown) => request.post(`${RUNNER}/${path}`, { headers: { Authorization: `Bearer ${token}` }, data: data ?? {} });

test("owner links an account with a one-time code, approves the exact text, and the result shows as confirmed only with bound evidence", async ({ page, request }) => {
  const account = await register(request, "exec-ui");
  const s = await seed(request, account);
  await signIn(page, account);
  await openExecution(page, account);

  const connections = page.getByRole("region", { name: "Подключения HH" });
  await expect(connections.getByText("Подключений нет.")).toBeVisible();
  await connections.getByLabel("Профиль").selectOption({ label: "Синтетический Кандидат" });
  await connections.getByLabel("Название аккаунта (для вас)").fill("hh: синтетика");
  await connections.getByRole("button", { name: "Создать подключение" }).click();
  const codeBox = connections.getByRole("status").filter({ hasText: "Код сопряжения" });
  await expect(codeBox).toBeVisible();
  const code = (await codeBox.locator("p.font-mono").innerText()).trim();
  expect(code).toMatch(/^ohp_[a-f0-9]{48}$/);
  await expect(connections.getByText("Ждёт локальный исполнитель")).toBeVisible();

  // имитация исполнителя: сопряжение по коду
  const bound = (await (await request.post(`${RUNNER}/bind`, { data: { pairingCode: code, externalAccountId: "acc-ui", accountDisplay: "Синтетический аккаунт", runnerId: "runner-ui", contractVersion: "opportunities-executor/v1" } })).json()) as { runnerToken: string };
  await expect(connections.getByText("Подключён", { exact: false }).first()).toBeVisible({ timeout: 15000 });
  await codeBox.getByRole("button", { name: "Скрыть код" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Отправка" }).click();
  await expect(page.getByText(code)).toHaveCount(0); // код больше нигде не виден

  // подготовка отправки из одобренного черновика
  const form = page.getByRole("region", { name: "Новая отправка" });
  await form.getByLabel("Одобренный черновик").selectOption({ index: 1 });
  await form.getByLabel("Подключённый аккаунт").selectOption({ index: 1 });
  await form.getByRole("button", { name: "Подготовить отправку" }).click();
  const card = page.getByRole("article").first();
  await expect(card.getByText("Ждёт согласования")).toBeVisible();
  await expect(card.getByText(/Писал SQL запросы для отчётности/)).toBeVisible();
  await expect(card.getByText(/Хэш содержимого: [a-f0-9]{64}/)).toBeVisible();
  // до согласования исполнитель ничего не получает
  expect(((await (await post(request, bound.runnerToken, "claim")).json()) as { job: unknown }).job).toBeNull();

  await card.getByRole("button", { name: "Согласовать отправку" }).click();
  await expect(card.getByText("Согласовано, ждёт исполнителя")).toBeVisible();
  await expect(card.getByText(/Разрешение: действует/)).toBeVisible();

  // исполнитель: claim → reserve → result
  const job = (await (await post(request, bound.runnerToken, "claim")).json()) as { job: { attemptId: string; leaseToken: string } };
  expect(job.job).not.toBeNull();
  const reserve = (await (await post(request, bound.runnerToken, "reserve", { attemptId: job.job.attemptId, leaseToken: job.job.leaseToken, observedAccountId: "acc-ui", baselineExists: false })).json()) as { proceed: boolean };
  expect(reserve.proceed).toBe(true);
  const insufficient = (await (await post(request, bound.runnerToken, "result", { attemptId: job.job.attemptId, leaseToken: job.job.leaseToken, outcome: "confirmed", evidence: [{ kind: "note", at: new Date().toISOString(), text: "success" }] })).json()) as { accepted: boolean; state: string };
  expect(insufficient).toMatchObject({ accepted: false, state: "sent_unconfirmed" });
  await expect(card.getByText("Отправка не подтверждена — нужна сверка").first()).toBeVisible({ timeout: 15000 });
  await expect(card.getByText("Отправка могла произойти.", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Отменить" })).toHaveCount(0);

  // позднее подтверждение с доказательством, привязанным к аккаунту и вакансии
  const late = (await (await post(request, bound.runnerToken, "result", { attemptId: job.job.attemptId, leaseToken: job.job.leaseToken, outcome: "confirmed", evidence: [{ kind: "event_id", at: new Date().toISOString(), accountId: "acc-ui", recipientExternalId: s.externalId, ref: "neg-1" }] })).json()) as { accepted: boolean; state: string };
  expect(late).toMatchObject({ accepted: true, state: "confirmed" });
  await expect(card.getByText("Отправка подтверждена").first()).toBeVisible({ timeout: 15000 });
  await expect(card.getByText(/Подтверждено исполнителем по событию/)).toBeVisible();
});

test("stopping the connection cancels the approved queue and revokes the grant", async ({ page, request }) => {
  const account = await register(request, "exec-ui2");
  await seed(request, account, "7770002");
  const conn = (await (await request.post(`${base(account)}/opportunity-execution/connections`, { headers: auth(account), data: { profileId: (await (await request.get(`${base(account)}/opportunity-profiles`, { headers: auth(account) })).json()).items[0].id, accountLabel: "hh: вторая" } })).json()) as { pairingCode: string; id: string };
  await request.post(`${RUNNER}/bind`, { data: { pairingCode: conn.pairingCode, externalAccountId: "acc-ui2", accountDisplay: "", runnerId: "runner-ui2", contractVersion: "opportunities-executor/v1" } });
  await signIn(page, account);
  await openExecution(page, account);
  const form = page.getByRole("region", { name: "Новая отправка" });
  await form.getByLabel("Одобренный черновик").selectOption({ index: 1 });
  await form.getByLabel("Подключённый аккаунт").selectOption({ index: 1 });
  await form.getByRole("button", { name: "Подготовить отправку" }).click();
  const card = page.getByRole("article").first();
  await card.getByRole("button", { name: "Согласовать отправку" }).click();
  await expect(card.getByText("Согласовано, ждёт исполнителя")).toBeVisible();
  // «Остановить всё» отменяет очередь и отзывает разрешение
  await page.getByRole("region", { name: "Подключения HH" }).getByRole("button", { name: "Остановить всё" }).click();
  await expect(card.getByText("Отменено", { exact: true }).first()).toBeVisible({ timeout: 15000 });
  await expect(card.getByText(/Разрешение: отозвано/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Подключения HH" }).getByText("Приостановлен").first()).toBeVisible();
});
