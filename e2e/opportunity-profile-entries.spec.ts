import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";

/** R0.2: правка/архив фактов и треков, общий журнал исторических откликов — через интерфейс, синтетические данные. */

const auth = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });
const base = (account: Account) => `${apiUrl()}/workspaces/${account.workspaceId}`;

async function enable(request: APIRequestContext, account: Account): Promise<void> {
  for (const id of ["opportunities-profiles", "opportunities-hh-import"]) {
    const response = await request.patch(`${base(account)}/plugins/${id}`, { headers: auth(account), data: { enabled: true } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

test("facts and tracks: edit resets confirmation, archive hides and restores, unsaved edit blocks resume choice", async ({ page, request }) => {
  const account = await register(request, "entries");
  await enable(request, account);
  const created = await request.post(`${base(account)}/opportunity-profiles`, { headers: auth(account), data: { displayName: "Синтетический кандидат", kind: "person", acknowledgeWorkspaceVisibility: true } });
  const profile = (await created.json()) as { id: string };
  const fact = (await (await request.post(`${base(account)}/opportunity-profiles/${profile.id}/facts`, { headers: auth(account), data: { statement: "Вёл команду из пяти человек", source: "резюме 2025" } })).json()) as { id: string; revision: number };
  await request.patch(`${base(account)}/opportunity-profiles/${profile.id}/facts/${fact.id}`, { headers: auth(account), data: { expectedRevision: fact.revision, state: "confirmed" } });
  await request.post(`${base(account)}/opportunity-profiles/${profile.id}/tracks`, { headers: auth(account), data: { name: "Аналитик", factIds: [fact.id] } });
  await request.post(`${base(account)}/opportunity-profiles/${profile.id}/materials`, { headers: auth(account), data: { title: "Резюме A", type: "resume", content: "текст" } });

  await signIn(page, account);
  await page.goto(`/panel/opportunities?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Профили" }).click();
  await page.getByRole("button", { name: "Синтетический кандидат" }).first().click();

  const facts = page.getByRole("region", { name: "Факты" });
  const tracks = page.getByRole("region", { name: "Треки" });
  await expect(facts.getByText(/Подтверждён владельцем/)).toBeVisible();
  await expect(tracks.getByText(/из них подтверждено владельцем: 1/)).toBeVisible();

  // открытая правка блокирует выбор резюме
  await facts.getByRole("button", { name: "Изменить", exact: true }).click();
  await expect(page.getByRole("button", { name: /Выбрать активным резюме/ })).toBeDisabled();
  await facts.getByLabel("Формулировка").fill("Вёл команду из шести человек");
  await facts.getByRole("button", { name: "Сохранить факт" }).click();
  await expect(facts.getByText("Вёл команду из шести человек")).toBeVisible();
  await expect(facts.getByText(/Не проверен/)).toBeVisible();
  await expect(tracks.getByText(/из них подтверждено владельцем: 0/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Выбрать активным резюме/ })).toBeEnabled();

  // трек: переименование
  await tracks.getByRole("button", { name: "Изменить трек" }).click();
  await tracks.getByLabel("Название трека").fill("Бизнес-аналитик");
  await tracks.getByRole("button", { name: "Сохранить трек" }).click();
  await expect(tracks.getByText("Бизнес-аналитик")).toBeVisible();

  // архив факта: скрыт, виден по переключателю, возвращается; трек в архив
  await facts.getByRole("button", { name: "В архив" }).click();
  await expect(facts.getByText("Вёл команду из шести человек")).toHaveCount(0);
  await facts.getByLabel(/Показать архивные/).check();
  await expect(facts.getByText(/В архиве/)).toBeVisible();
  await facts.getByRole("button", { name: "Вернуть из архива" }).click();
  await expect(facts.getByText(/В архиве/)).toHaveCount(0);
  await tracks.getByRole("button", { name: "Трек в архив" }).click();
  await expect(tracks.getByText("Бизнес-аналитик")).toHaveCount(0);
  await tracks.getByLabel(/Показать архивные/).check();
  await tracks.getByRole("button", { name: "Вернуть трек" }).click();
  await expect(tracks.getByText("Бизнес-аналитик")).toBeVisible();
});

test("historical response log shows records without a vacancy card, filters and never calls legacy verified a confirmed send", async ({ page, request }) => {
  const account = await register(request, "history");
  await enable(request, account);
  const preview = await request.post(`${base(account)}/opportunity-hh-import/preview`, {
    headers: auth(account),
    data: {
      acknowledgeWorkspaceVisibility: true, includeHistory: true,
      files: [{ path: "applications/log.json", text: JSON.stringify([
        { title: "Синтетическая вакансия A", url: "https://hh.ru/vacancy/777001", verified: true },
        { title: "Заказ без карточки", reason: "already_applied" },
        { title: "Ошибочная запись", success: false }
      ]) }]
    }
  });
  expect(preview.status(), await preview.text()).toBe(201);
  let run = (await preview.json()) as { id: string; revision: number; manifestHash: string; status: string };
  while (run.status !== "applied") {
    const next = await request.post(`${base(account)}/opportunity-hh-import/${run.id}/apply`, { headers: auth(account), data: { expectedRevision: run.revision, manifestHash: run.manifestHash } });
    expect(next.ok()).toBe(true); run = (await next.json()) as typeof run;
  }
  await signIn(page, account);
  await page.goto(`/panel/opportunities?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Импорт HH" }).click();
  const log = page.getByRole("region", { name: "Журнал исторических откликов" });
  await expect(log.getByText("Всего: 3; без карточки вакансии: 3; возможных дублей: 0.")).toBeVisible();
  await expect(log.getByText("Заказ без карточки")).toBeVisible();
  await expect(log.getByRole("listitem").getByText("Старый журнал: «проверено» (ORION не подтверждал)")).toBeVisible();
  await expect(log.getByText(/подтвержд[её]н(а|ная)? отправк/i)).toHaveCount(0);

  await log.getByLabel("Итог").selectOption("failed");
  await expect(log.getByText("Ошибочная запись")).toBeVisible();
  await expect(log.getByText("Заказ без карточки")).toHaveCount(0);
  await log.getByLabel("Итог").selectOption("already_exists");
  await log.getByLabel("Возможные дубли").check();
  await expect(log.getByText(/По выбранным условиям записей нет/)).toBeVisible();
});
