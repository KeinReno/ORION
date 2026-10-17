import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

/** R1.2 через интерфейс: явная политика, цикл по кнопке, отчёт, пауза и остановка. Исполнитель имитируется протоколом. */

const auth = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });
const base = (account: Account) => `${apiUrl()}/workspaces/${account.workspaceId}`;
const RUNNER = `${apiUrl()}/opportunities-executor/v1`;

async function seed(request: APIRequestContext, account: Account) {
  for (const id of ["opportunities-profiles", "opportunities-assistant", "opportunities-execution", "opportunities-manager"]) expect((await request.patch(`${base(account)}/plugins/${id}`, { headers: auth(account), data: { enabled: true } })).ok()).toBe(true);
  const profile = (await (await request.post(`${base(account)}/opportunity-profiles`, { headers: auth(account), data: { displayName: "Синтетический Кандидат", kind: "person", acknowledgeWorkspaceVisibility: true } })).json()) as { id: string };
  const fact = (await (await request.post(`${base(account)}/opportunity-profiles/${profile.id}/facts`, { headers: auth(account), data: { statement: "Писал SQL запросы для отчётности", source: "синтетическая заметка" } })).json()) as { id: string; revision: number };
  await request.patch(`${base(account)}/opportunity-profiles/${profile.id}/facts/${fact.id}`, { headers: auth(account), data: { expectedRevision: fact.revision, state: "confirmed" } });
  const resume = (await (await request.post(`${base(account)}/opportunity-profiles/${profile.id}/materials`, { headers: auth(account), data: { title: "Резюме v1", type: "resume", content: "SQL" } })).json()) as { id: string };
  const detail = (await (await request.get(`${base(account)}/opportunity-profiles/${profile.id}`, { headers: auth(account) })).json()) as { revision: number };
  await request.post(`${base(account)}/opportunity-profiles/${profile.id}/active-resume`, { headers: auth(account), data: { expectedRevision: detail.revision, materialId: resume.id } });
  for (const [externalId, description] of [["8880001", "Требования:\n- Опыт написания SQL запросов"], ["8880002", "Требования:\n- Опыт написания SQL запросов\n- Знание BPMN нотации"]]) {
    await request.post(`${base(account)}/opportunities`, { headers: auth(account), data: { kind: "job", title: `Аналитик ${externalId}`, organizationName: "Синтетик", description, sourceType: "hh", externalId, canonicalUrl: `https://hh.ru/vacancy/${externalId}`, conditions: { workFormat: "remote", amountMin: 150000, amountMax: 200000, paymentBasis: "monthly", taxBasis: "net" } } });
  }
  const conn = (await (await request.post(`${base(account)}/opportunity-execution/connections`, { headers: auth(account), data: { profileId: profile.id, accountLabel: "hh: менеджер" } })).json()) as { pairingCode: string };
  const bound = (await (await request.post(`${RUNNER}/bind`, { data: { pairingCode: conn.pairingCode, externalAccountId: "acc-mgr", accountDisplay: "", runnerId: "runner-mgr", contractVersion: "opportunities-executor/v1" } })).json()) as { runnerToken: string };
  return { token: bound.runnerToken };
}

test("owner enables a limited policy explicitly, runs a cycle, sees the report and stops the manager", async ({ page, request }) => {
  const account = await register(request, "mgr-ui");
  const { token } = await seed(request, account);
  await signIn(page, account);
  await page.goto(`/panel/opportunities?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Менеджер" }).click();
  await expect(page.getByText("фонового запуска нет")).toBeVisible();

  const form = page.getByRole("heading", { name: "Новая политика автономности" });
  await expect(form).toBeVisible();
  await page.getByLabel("Подключённый аккаунт HH").selectOption({ index: 1 });
  await page.getByLabel(/Порог рейтинга/).fill("50");
  const enable = page.getByRole("button", { name: "Включить менеджера" });
  await expect(enable).toBeDisabled();                                    // без явного согласия включить нельзя
  await page.getByLabel(/Я понимаю: в пределах этой политики/).check();
  await enable.click();

  const policy = page.getByRole("region", { name: "Действующая политика" });
  await expect(policy.getByText("Политика: Действует")).toBeVisible();
  await expect(policy.getByText(/всего осталось действий: 10 из 10/)).toBeVisible();
  await policy.getByRole("button", { name: "Запустить цикл" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Цикл завершён" })).toBeVisible();

  const report = page.getByRole("region", { name: "Отчёт менеджера" });
  await expect(report.getByText(/В очередь поставлено: 1; пропущено: 0; на ваше решение: 1/).or(report.getByText(/В очередь поставлено: 1; пропущено: 1/))).toBeVisible();
  await expect(report.getByText("Аналитик 8880001 · Поставлено в очередь отправки")).toBeVisible();
  await expect(report.getByText(/Итог отправок по политике: ждут исполнителя: 1/)).toBeVisible();
  const unclear = report.getByRole("listitem").filter({ hasText: "Аналитик 8880002" }).first();
  await expect(unclear.getByText(/BPMN/).first()).toBeVisible();          // сомнительная вакансия не ушла в очередь

  // отправка в очереди — реально выдаётся исполнителю по обычному протоколу
  const claim = (await (await request.post(`${RUNNER}/claim`, { headers: { Authorization: `Bearer ${token}` }, data: {} })).json()) as { job: { attemptId: string } | null };
  expect(claim.job).not.toBeNull();

  // пауза и остановка
  await policy.getByRole("button", { name: "Приостановить" }).click();
  await expect(page.getByRole("region", { name: "Действующая политика" }).getByText("Политика: Приостановлена")).toBeVisible();
  await page.getByRole("region", { name: "Действующая политика" }).getByRole("button", { name: "Остановить насовсем" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Остановить политику" }).click();
  await expect(page.getByRole("heading", { name: "Новая политика автономности" })).toBeVisible();   // политика завершена, новая создаётся явно
});
