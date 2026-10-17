import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiUrl, register, signIn, type Account } from "./support";
import type { Draft } from "@orion/shared-types";

/** R0.3: оценка с основаниями, черновик, правка, одобрение текста и пробный запуск — через интерфейс, на синтетических данных. */

const auth = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });
const base = (account: Account) => `${apiUrl()}/workspaces/${account.workspaceId}`;
const DESCRIPTION = "Требования:\n- Опыт написания SQL запросов\n- Знание BPMN нотации\n- Управление бэклогом\n\nБудет плюсом:\n- Знание Python";

async function seed(request: APIRequestContext, account: Account) {
  for (const id of ["opportunities-profiles", "opportunities-assistant"]) expect((await request.patch(`${base(account)}/plugins/${id}`, { headers: auth(account), data: { enabled: true } })).ok()).toBe(true);
  const opp = (await (await request.post(`${base(account)}/opportunities`, { headers: auth(account), data: { kind: "job", title: "Бизнес-аналитик", organizationName: "Синтетик", description: DESCRIPTION, conditions: { workFormat: "remote", amountMin: 150000, amountMax: 200000, paymentBasis: "monthly", taxBasis: "net" } } })).json()) as { id: string };
  const profile = (await (await request.post(`${base(account)}/opportunity-profiles`, { headers: auth(account), data: { displayName: "Синтетический Кандидат", kind: "person", acknowledgeWorkspaceVisibility: true } })).json()) as { id: string };
  const fact = async (statement: string, confirm: boolean) => {
    const created = (await (await request.post(`${base(account)}/opportunity-profiles/${profile.id}/facts`, { headers: auth(account), data: { statement, source: "синтетическая заметка" } })).json()) as { id: string; revision: number };
    if (confirm) await request.patch(`${base(account)}/opportunity-profiles/${profile.id}/facts/${created.id}`, { headers: auth(account), data: { expectedRevision: created.revision, state: "confirmed" } });
    return created;
  };
  const sql = await fact("Писал SQL запросы для отчётности", true);
  await fact("Управлял бэклогом продукта пять лет", true);
  await fact("Знаю нотацию BPMN", false);
  const resume = (await (await request.post(`${base(account)}/opportunity-profiles/${profile.id}/materials`, { headers: auth(account), data: { title: "Резюме v1", type: "resume", content: "Бизнес-аналитик. SQL." } })).json()) as { id: string };
  const detail = (await (await request.get(`${base(account)}/opportunity-profiles/${profile.id}`, { headers: auth(account) })).json()) as { revision: number };
  await request.post(`${base(account)}/opportunity-profiles/${profile.id}/active-resume`, { headers: auth(account), data: { expectedRevision: detail.revision, materialId: resume.id } });
  return { oppId: opp.id, profileId: profile.id, sql };
}

async function openCard(page: Page, account: Account): Promise<void> {
  await page.goto(`/panel/opportunities?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: /Бизнес-аналитик/ }).first().click();
  await expect(page.getByRole("region", { name: "Ассистент" })).toBeVisible();
}

test("unsaved draft survives section navigation and a remote edit; stale revision cannot overwrite the other window", async ({ page, request }) => {
  const account = await register(request, "draft-preservation"); const s = await seed(request, account);
  await signIn(page, account); await openCard(page, account);
  const section = page.getByRole("region", { name: "Ассистент" });
  await section.getByRole("button", { name: "Подготовить отклик" }).click();
  const editor = page.getByRole("region", { name: "Редактор черновика" });
  const field = editor.locator("textarea").first();
  const localText = "Мой несохранённый текст из первого окна";
  await field.fill(localText);
  await page.getByRole("button", { name: "Профили", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(field).toHaveValue(localText);
  await editor.getByRole("button", { name: "Закрыть черновик" }).click();
  await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
  const list = (await (await request.get(`${base(account)}/opportunity-assistant/drafts?opportunityId=${s.oppId}`, { headers: auth(account) })).json()) as { items: Draft[] };
  const draft = list.items[0];
  const updated = await request.patch(`${base(account)}/opportunity-assistant/drafts/${draft.id}`, { headers: auth(account), data: { expectedRevision: draft.revision, sections: draft.sections.map((part, n) => ({ id: part.id, text: n === 0 ? "Сохранённый текст второго окна" : part.text, factIds: part.factIds })) } });
  expect(updated.ok(), await updated.text()).toBe(true);
  await editor.getByRole("button", { name: "Проверить актуальность" }).click();
  await expect(editor.getByText(/Черновик изменён в другом окне/)).toBeVisible();
  await expect(field).toHaveValue(localText);
  await editor.getByRole("button", { name: "Сохранить правки" }).click();
  await expect(editor.getByRole("alert")).toBeVisible(); await expect(field).toHaveValue(localText);
  const latest = (await (await request.get(`${base(account)}/opportunity-assistant/drafts/${draft.id}`, { headers: auth(account) })).json()) as Draft;
  expect(latest.sections[0].text).toBe("Сохранённый текст второго окна");
  await editor.getByRole("button", { name: "Загрузить актуальную версию" }).click();
  await confirm.getByRole("button", { name: "Продолжить без сохранения" }).click();
  await expect(field).toHaveValue("Сохранённый текст второго окна");
});

test("assessment shows evidence, gaps and unknowns; draft is built from confirmed facts, edited, approved and dry-run without sending", async ({ page, request }) => {
  const account = await register(request, "assistant");
  const s = await seed(request, account);
  await signIn(page, account);
  await openCard(page, account);
  const section = page.getByRole("region", { name: "Ассистент" });

  await expect(section.getByText(/ничего не отправляется/)).toBeVisible();
  await section.getByRole("button", { name: "Оценить соответствие" }).click();
  const assessment = section.getByLabel("Оценка соответствия");
  await expect(assessment.getByText(/Рейтинг:/)).toBeVisible();
  const sqlRow = assessment.locator("li").filter({ hasText: "Обязательно: «Опыт написания SQL запросов»" }).first();
  await expect(sqlRow.getByText("Соответствует (подтверждено)")).toBeVisible();
  await expect(sqlRow.getByText(/Факт, подтверждён владельцем/)).toBeVisible();
  const bpmnRow = assessment.locator("li").filter({ hasText: "Обязательно: «Знание BPMN нотации»" }).first();
  await expect(bpmnRow.getByText("Неизвестно: есть только непроверенные сведения")).toBeVisible();
  await expect(bpmnRow.getByText(/Факт, не проверен/)).toBeVisible();
  const pythonRow = assessment.locator("li").filter({ hasText: "Желательно: «Знание Python»" }).first();
  await expect(pythonRow.getByText("Пробел")).toBeVisible();
  await expect(assessment.getByText("Что ассистент не знает")).toBeVisible();

  // черновик из подтверждённых фактов
  await section.getByRole("button", { name: "Подготовить отклик" }).click();
  const editor = page.getByRole("region", { name: "Редактор черновика" });
  await expect(editor.getByText("Опирается на подтверждённые факты").first()).toBeVisible();
  await expect(editor.locator("textarea").filter({ hasText: "Писал SQL запросы для отчётности" })).toHaveCount(1);
  await expect(editor.locator("textarea").filter({ hasText: "BPMN" })).toHaveCount(0);
  await expect(editor.getByText(/Не подтверждено: «Знание BPMN нотации»/)).toBeVisible();

  // пробный запуск до одобрения: блокировки видны, ничего не отправляется
  await editor.getByRole("button", { name: "Пробный запуск" }).click();
  const dry = editor.getByLabel("Результат пробного запуска");
  await expect(dry.getByText("Пробный запуск: ничего не отправлено")).toBeVisible();
  await expect(dry.getByText("Текст не одобрен владельцем.")).toBeVisible();

  // правка раздела: несохранённый ввод блокирует действия, ручной раздел требует подтверждения
  const closing = editor.locator("textarea").filter({ hasText: "Буду рад обсудить детали." });
  await closing.fill("Готов выйти на связь в удобное время.");
  await expect(editor.getByRole("button", { name: "Закрыть черновик" })).toBeEnabled(); // closing asks before discarding dirty text
  await expect(editor.getByRole("button", { name: "Пробный запуск" })).toBeDisabled();
  await editor.getByRole("button", { name: "Сохранить правки" }).click();
  await expect(editor.getByText("Изменено вручную: проверьте достоверность")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Одобрить текст" })).toBeDisabled();
  await editor.getByLabel(/Я проверил\(а\) разделы/).check();
  await editor.getByRole("button", { name: "Одобрить текст" }).click();
  await expect(editor.getByRole("heading", { name: /Текст одобрен владельцем/ })).toBeVisible();
  await editor.getByRole("button", { name: "Пробный запуск" }).click();
  await expect(dry.getByText(/Хэш содержимого: [a-f0-9]{64}/)).toBeVisible();
  await expect(dry.getByText("Текст не одобрен владельцем.")).toHaveCount(0);
  await expect(dry.getByText(/Готов выйти на связь в удобное время\./)).toBeVisible();

  // изменение подтверждённого факта: оценка и черновик устаревают
  await request.patch(`${base(account)}/opportunity-profiles/${s.profileId}/facts/${s.sql.id}/content`, { headers: auth(account), data: { expectedRevision: 1, statement: "Писал SQL запросы для отчётности и витрин" } });
  await page.reload();
  await page.getByRole("button", { name: /Бизнес-аналитик/ }).first().click();
  await expect(section.getByText("Оценка устарела.")).toBeVisible();
  await section.getByRole("button", { name: /Одобрен|Отчёт|Отклик на вакансию/ }).first().click();
  await expect(page.getByRole("region", { name: "Редактор черновика" }).getByText("Исходные данные изменились:")).toBeVisible();
  await expect(page.getByRole("region", { name: "Редактор черновика" }).getByRole("button", { name: "Одобрить текст" })).toBeDisabled();
  await section.getByRole("button", { name: "Пересчитать оценку" }).click();
  await expect(section.getByText("Оценка устарела.")).toHaveCount(0);
  void s.oppId;
});

test("answer without confirmed facts stays empty; 390 px has no horizontal overflow", async ({ page, request }) => {
  const account = await register(request, "assistant-mobile");
  await seed(request, account);
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, account);
  await openCard(page, account);
  const section = page.getByRole("region", { name: "Ассистент" });
  await section.getByLabel("Вопрос из анкеты работодателя").fill("Есть ли опыт руководства командой разработчиков?");
  await section.getByRole("button", { name: "Подготовить ответ" }).click();
  const editor = page.getByRole("region", { name: "Редактор черновика" });
  await expect(editor.getByText("Нет подтверждённых сведений — напишите сами")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Одобрить текст" })).toBeDisabled();
  await section.getByRole("button", { name: /Оценить/ }).click();
  await expect(section.getByLabel("Оценка соответствия")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a member sees the assessment and drafts but cannot approve or reject", async ({ page, request }) => {
  const owner = await register(request, "assistant-owner");
  const member = await register(request, "assistant-member");
  await seed(request, owner);
  const me = (await (await request.get(`${apiUrl()}/auth/me`, { headers: auth(member) })).json()) as { email: string };
  const invite = (await (await request.post(`${base(owner)}/invites`, { headers: auth(owner), data: { email: me.email, role: "member" } })).json()) as { code: string };
  expect((await request.post(`${apiUrl()}/invites/${invite.code}/accept`, { headers: auth(member) })).ok()).toBe(true);
  await signIn(page, { ...member, workspaceId: owner.workspaceId });
  await openCard(page, { ...member, workspaceId: owner.workspaceId });
  const section = page.getByRole("region", { name: "Ассистент" });
  await section.getByRole("button", { name: "Подготовить отклик" }).click();
  const editor = page.getByRole("region", { name: "Редактор черновика" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "Одобрить текст" })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Отклонить" })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Пробный запуск" })).toBeEnabled();
});
