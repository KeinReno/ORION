import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Attempt, HhImportRun, Opportunity, Policy } from "@orion/shared-types";
import { Hub } from "./opportunity-hub-fixtures";

/**
 * Итоговая приёмка Hub на PostgreSQL (серверные уровни). Исполнитель — имитация протокола; живой hh.ru не использовался.
 * Эти тесты НЕ заменяют G20 (живой сценарий с разрешением владельца) и проверку установленного приложения.
 */
describe("Hub acceptance: personal scenario, team scenario, extensions off/on", () => {
  const hub = new Hub();
  beforeAll(() => hub.start());
  afterAll(() => hub.stop());

  const ALL = ["opportunities-profiles", "opportunities-hh-import", "opportunities-assistant", "opportunities-execution", "opportunities-manager"];

  it("personal path end to end: HH file import → profile → confirmed fact → assessment → draft → approval → grant → runner → confirmed", async () => {
    const a = await hub.register("personal"); await hub.enable(a, ...ALL);
    const importer = `/workspaces/${a.workspaceId}/opportunity-hh-import`;
    // 1) импорт: резюме кандидата (текст), снимок вакансии HH — ничего не отправляется и не подтверждается
    const files = [
      { path: "HH/Мария/Резюме/Аналитик.md", text: "Бизнес-аналитик. Писал SQL запросы для отчётности." },
      { path: "vacancies_synthetic.json", text: JSON.stringify([{ title: "Бизнес-аналитик", url: "https://hh.ru/vacancy/5550001", employer: { name: "Синтетик" }, description: "Требования:\n- Опыт написания SQL запросов", salary: { from: 150000, to: 200000, currency: "RUR", gross: false } }]) }
    ];
    const preview = await hub.req<HhImportRun>(`${importer}/preview`, a.token, "POST", { files, includeProfiles: true, includeHistory: false, acknowledgeWorkspaceVisibility: true });
    expect(preview.status).toBe(201);
    let run = preview.data;
    while (run.status !== "applied") run = (await hub.req<HhImportRun>(`${importer}/${run.id}/apply`, a.token, "POST", { expectedRevision: run.revision, manifestHash: run.manifestHash })).data;
    expect(run.report).toMatchObject({ opportunitiesCreated: 1, materialsCreated: 1 });
    const opp = (await hub.req<{ items: Opportunity[] }>(`/workspaces/${a.workspaceId}/opportunities`, a.token)).data.items[0];
    expect(opp).toMatchObject({ sourceType: "hh", externalId: "5550001" });
    // условия вакансии приходят в карточку (месячная зарплата «на руки» — по полям снимка)
    await hub.req(`/workspaces/${a.workspaceId}/opportunities/${opp.id}`, a.token, "PATCH", { expectedRevision: opp.revision, conditions: { ...opp.conditions, paymentBasis: "monthly", workFormat: "remote" } });

    // 2) профиль создан импортом, факты — только вручную и только подтверждением владельца
    const profile = (await hub.req<{ items: { id: string }[] }>(hub.profilesPath(a), a.token)).data.items[0];
    const detail = (await hub.req<{ facts: unknown[]; materials: { items: { id: string; type: string }[] }; revision: number }>(`${hub.profilesPath(a)}/${profile.id}`, a.token)).data;
    expect(detail.facts).toEqual([]);                                          // текст резюме ничего не подтвердил
    const fact = (await hub.req<{ id: string; revision: number }>(`${hub.profilesPath(a)}/${profile.id}/facts`, a.token, "POST", { statement: "Писал SQL запросы для отчётности", source: "резюме и разговор" })).data;
    const assessedBefore = (await hub.req<{ criteria: { verdict: string }[] }>(`${hub.assistantPath(a)}/assessments`, a.token, "POST", { opportunityId: opp.id, profileId: profile.id })).data;
    expect(assessedBefore.criteria[0].verdict).toBe("unknown");                // факт не подтверждён — совпадения нет
    await hub.req(`${hub.profilesPath(a)}/${profile.id}/facts/${fact.id}`, a.token, "PATCH", { expectedRevision: fact.revision, state: "confirmed" });
    expect((await hub.req(`${hub.profilesPath(a)}/${profile.id}/active-resume`, a.token, "POST", { expectedRevision: detail.revision, materialId: detail.materials.items[0].id })).status).toBe(201);
    const draft = (await hub.req<{ id: string; revision: number; textHash: string; text: string }>(`${hub.assistantPath(a)}/drafts`, a.token, "POST", { opportunityId: opp.id, profileId: profile.id, kind: "response" })).data;
    expect(draft.text).toContain("Писал SQL запросы");
    expect((await hub.req(`${hub.assistantPath(a)}/drafts/${draft.id}/approve`, a.token, "POST", { expectedRevision: draft.revision, textHash: draft.textHash })).status).toBe(201);

    // 3) подключение, согласование конкретного отклика, исполнитель, подтверждение
    const conn = await hub.connection(a, profile.id);
    const runner = hub.runner((await hub.bind(conn.pairingCode, "acc-personal", "runner-personal")).runnerToken);
    const att = await hub.queued(a, conn.id, draft.id);
    const job = (await runner.claim()).data.job!;
    expect(job.payload.recipient).toMatchObject({ externalId: "5550001", sourceType: "hh" });
    expect((await runner.reserve(att.id, job.leaseToken, "acc-personal")).data.proceed).toBe(true);
    expect((await runner.result(att.id, job.leaseToken, "confirmed", [hub.confirming("5550001", "acc-personal")])).data.state).toBe("confirmed");
    const done = (await hub.attempt(a, att.id)).data;
    expect(done).toMatchObject({ state: "confirmed", confirmationBasis: "runner_observed", initiatedBy: null });
    // 4) повторный импорт ничего не задваивает и не затирает ручные правки
    const again = await hub.req<HhImportRun>(`${importer}/preview`, a.token, "POST", { files, includeProfiles: true, includeHistory: false, acknowledgeWorkspaceVisibility: true });
    let run2 = again.data;
    while (run2.status !== "applied") run2 = (await hub.req<HhImportRun>(`${importer}/${run2.id}/apply`, a.token, "POST", { expectedRevision: run2.revision, manifestHash: run2.manifestHash })).data;
    expect(run2.report).toMatchObject({ opportunitiesCreated: 0, opportunitiesExisting: 1, materialsCreated: 0 });
    const after = (await hub.req<Opportunity>(`/workspaces/${a.workspaceId}/opportunities/${opp.id}`, a.token)).data;
    expect(after.conditions.paymentBasis).toBe("monthly");                     // ручная правка сохранилась
  });

  it("team workspace: members read and prepare, only the owner approves, connects and delegates; other workspaces see nothing", async () => {
    const owner = await hub.register("team-owner"); const member = await hub.register("team-member"); const outsider = await hub.register("team-outsider");
    await hub.enable(owner, ...ALL);
    await hub.prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: member.userId, role: "member" } }));
    const s = await hub.scenario(owner, { approve: false });
    // участник видит профиль, оценку и черновик; готовит новый черновик; пробный запуск доступен
    expect((await hub.req(`${hub.profilesPath(owner)}/${s.profile.id}`, member.token)).status).toBe(200);
    const memberDraft = await hub.req<{ id: string; revision: number; textHash: string }>(`${hub.assistantPath(owner)}/drafts`, member.token, "POST", { opportunityId: s.opp.id, profileId: s.profile.id, kind: "response" });
    expect(memberDraft.status).toBe(201);
    expect((await hub.req(`${hub.assistantPath(owner)}/drafts/${memberDraft.data.id}/dry-run`, member.token, "POST")).status).toBe(201);
    // …но не одобряет, не подключает аккаунт, не создаёт политику и не видит попытки/подключения
    expect((await hub.req(`${hub.assistantPath(owner)}/drafts/${memberDraft.data.id}/approve`, member.token, "POST", { expectedRevision: memberDraft.data.revision, textHash: memberDraft.data.textHash })).status).toBe(403);
    expect((await hub.req(`${hub.execPath(owner)}/connections`, member.token, "POST", { profileId: s.profile.id, accountLabel: "x" })).status).toBe(403);
    expect((await hub.req(`${hub.execPath(owner)}/attempts`, member.token)).status).toBe(403);
    expect((await hub.req(`/workspaces/${owner.workspaceId}/opportunity-manager/policies`, member.token)).status).toBe(403);
    // чужое пространство: ни чтения, ни ссылок на чужие id в своём
    await hub.enable(outsider, "opportunities-profiles", "opportunities-assistant");
    expect((await hub.req(`${hub.profilesPath(owner)}/${s.profile.id}`, outsider.token)).status).toBe(403);
    expect((await hub.req(`${hub.assistantPath(outsider)}/assessments`, outsider.token, "POST", { opportunityId: s.opp.id, profileId: s.profile.id })).status).toBe(404);
    expect((await hub.req(`${hub.assistantPath(outsider)}/drafts/${memberDraft.data.id}`, outsider.token)).status).toBe(404);
  });

  it("with every extension switched off Base keeps working and the data stays; switching on again restores access but runs nothing by itself", async () => {
    const a = await hub.register("offon"); await hub.enable(a, ...ALL);
    const s = await hub.scenario(a, { draft: true });
    const conn = await hub.connection(a, s.profile.id);
    const runner = hub.runner((await hub.bind(conn.pairingCode, "acc-offon", "runner-offon")).runnerToken);
    const att = await hub.queued(a, conn.id, s.draft.id);
    const policy = (await hub.req<Policy>(`/workspaces/${a.workspaceId}/opportunity-manager/policies`, a.token, "POST", { connectionId: conn.id, acknowledgeAutonomy: true })).data;
    const actionsBefore = await hub.prisma.asSystem((tx) => tx.opportunityManagerAction.count({ where: { workspaceId: a.workspaceId } }));

    for (const plugin of ALL) expect((await hub.req(`/workspaces/${a.workspaceId}/plugins/${plugin}`, a.token, "PATCH", { enabled: false })).status).toBe(200);
    // Base: создать, изменить, архивировать, прочитать, выгрузить
    const created = await hub.req<Opportunity>(`/workspaces/${a.workspaceId}/opportunities`, a.token, "POST", { kind: "contract", title: "Ручной заказ", organizationName: "Клиент", description: "Описание" });
    expect(created.status).toBe(201);
    expect((await hub.req(`/workspaces/${a.workspaceId}/opportunities/${created.data.id}`, a.token, "PATCH", { expectedRevision: created.data.revision, title: "Ручной заказ 2" })).status).toBe(200);
    expect((await hub.req<{ items: unknown[] }>(`/workspaces/${a.workspaceId}/opportunities`, a.token)).data.items.length).toBeGreaterThanOrEqual(2);
    expect((await hub.req<unknown[]>(`/workspaces/${a.workspaceId}/opportunities/export`, a.token)).status).toBe(200);
    // расширения недоступны: человеческий API и исполнитель
    expect((await hub.req(hub.profilesPath(a), a.token)).status).toBe(409);
    expect((await hub.req(`${hub.assistantPath(a)}/status`, a.token)).status).toBe(409);
    expect((await hub.req(`${hub.execPath(a)}/connections`, a.token)).status).toBe(409);
    expect((await hub.req(`/workspaces/${a.workspaceId}/opportunity-manager/policies`, a.token)).status).toBe(409);
    expect((await runner.claim()).status).toBe(409);
    expect((await hub.req(`/workspaces/${a.workspaceId}/opportunity-manager/policies/${policy.id}/run`, a.token, "POST")).status).toBe(409);

    for (const plugin of ALL) await hub.enable(a, plugin);
    // данные на месте; включение само ничего не запустило
    expect((await hub.req<{ items: unknown[] }>(hub.profilesPath(a), a.token)).data.items).toHaveLength(1);
    const attAfter = (await hub.attempt(a, att.id)).data as Attempt;
    expect(attAfter).toMatchObject({ state: "canceled", grant: { state: "revoked" } });
    expect(await hub.prisma.asSystem((tx) => tx.opportunityManagerAction.count({ where: { workspaceId: a.workspaceId } }))).toBe(actionsBefore);
    expect((await hub.connections(a)).data[0].state).toBe("paused");
    expect((await runner.claim()).data.job).toBeNull();
  });
});
