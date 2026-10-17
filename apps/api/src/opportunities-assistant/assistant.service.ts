import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { OpportunityAssessment as AssessmentRow, OpportunityDraft as DraftRow, Prisma } from "@prisma/client";
import {
  DRAFT_TEMPLATE_VERSION, assessmentSchema, draftSchema, dryRunSchema,
  type Assessment, type AssistantStatus, type CreateAssessmentInput, type CreateDraftInput, type Draft, type DryRun, type MaterialRef,
  type Opportunity, type RejectDraftInput, type ReviewDraftInput, type UpdateDraftInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { PluginsService } from "../plugins/plugins.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { OPPORTUNITIES_READ_PORT, type OpportunitiesReadPort } from "../opportunities/public";
import { PROFILE_EVIDENCE_PORT, type ProfileEvidence, type ProfileEvidencePort } from "../opportunities-profiles/public";
import { draftText, generateDraft, sectionBasis, type StoredSection } from "./draft-engine";
import { computeComponents, inputHash, sha256, stable, staleReasons, type Components } from "./fingerprint";
import { RULES_VERSION } from "./assessment-engine";
import type { AssistantAutomationPort } from "./automation-contract";
import type { AssistantDraftPort } from "./draft-contract";
import { assistantStatus, getProvider } from "./provider";

const PAGE = 20;
type Tx = Prisma.TransactionClient;
interface Context { opportunity: Opportunity; evidence: ProfileEvidence; components: Components }

const json = (value: unknown) => value as Prisma.InputJsonValue;
const textHashOf = (text: string, materials: MaterialRef[]) => sha256(stable({ text, materials: materials.map((m) => [m.id, m.contentHash]) }));

@Injectable()
export class AssistantService implements AssistantDraftPort, AssistantAutomationPort {
  constructor(
    private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly plugins: PluginsService,
    @Inject(OPPORTUNITIES_READ_PORT) private readonly opportunities: OpportunitiesReadPort,
    @Inject(PROFILE_EVIDENCE_PORT) private readonly profiles: ProfileEvidencePort
  ) {}

  private async guard(tx: Tx, user: string, ws: string, owner = false) {
    if (owner) await this.workspaces.assertMemberRoleTx(tx, user, ws, ["owner"]); else await this.workspaces.assertMemberTx(tx, user, ws);
    await this.plugins.assertEnabledTx(tx, user, ws, "opportunities-assistant");
  }

  private async context(tx: Tx, user: string, ws: string, opportunityId: string, profileId: string): Promise<Context> {
    const opportunity = await this.opportunities.readTx(tx, user, ws, opportunityId);
    const evidence = await this.profiles.readEvidenceTx(tx, user, ws, profileId);
    return { opportunity, evidence, components: computeComponents(opportunity, evidence) };
  }

  private async liveContext(tx: Tx, user: string, ws: string, opportunityId: string, profileId: string, cache: Map<string, Context>): Promise<Context> {
    const key = `${opportunityId}:${profileId}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const fresh = await this.context(tx, user, ws, opportunityId, profileId);
    cache.set(key, fresh);
    return fresh;
  }

  status(): AssistantStatus { return assistantStatus(); }

  /* ---------------- Оценки ---------------- */

  private assessmentDto(row: AssessmentRow, current: Components): Assessment {
    const inputs = row.inputs as unknown as Assessment["inputs"]; const result = row.result as unknown as Pick<Assessment, "criteria" | "conditions" | "unknowns" | "autoSendBlockers" | "breakdown">;
    const reasons = staleReasons(inputs.components, current);
    if (inputs.rulesVersion !== RULES_VERSION) reasons.push("Изменилась версия правил оценки");
    return assessmentSchema.parse({
      id: row.id, workspaceId: row.workspaceId, opportunityId: row.opportunityId, profileId: row.profileId, provider: { id: row.providerId, version: row.providerVersion },
      score: row.score, confidence: row.confidence, breakdown: result.breakdown, criteria: result.criteria, conditions: result.conditions, unknowns: result.unknowns, autoSendBlockers: result.autoSendBlockers,
      inputs, stale: reasons.length > 0, staleReasons: reasons, createdBy: row.createdById, createdAt: row.createdAt.toISOString()
    });
  }

  private async ensureAssessmentTx(tx: Tx, user: string, ws: string, ctx: Context, providerId: string): Promise<AssessmentRow> {
    const provider = getProvider(providerId);
    if (ctx.evidence.profile.archivedAt) throw new ConflictException("Профиль в архиве. Восстановите его, чтобы оценивать возможности.");
    if (ctx.opportunity.archivedAt) throw new ConflictException("Возможность в архиве. Восстановите её, чтобы оценивать.");
    const hash = inputHash(ctx.components, provider.id, provider.version);
    const existing = await tx.opportunityAssessment.findFirst({ where: { workspaceId: ws, opportunityId: ctx.opportunity.id, profileId: ctx.evidence.profile.id, inputHash: hash }, orderBy: { createdAt: "desc" } });
    if (existing) return existing;
    const out = provider.assess(ctx.opportunity, ctx.evidence);
    const confirmed = ctx.evidence.facts.filter((f) => f.state === "confirmed").length;
    const inputs = {
      opportunityId: ctx.opportunity.id, opportunityRevision: ctx.opportunity.revision, profileId: ctx.evidence.profile.id, profileRevision: ctx.evidence.profile.revision,
      factCount: ctx.evidence.facts.length, confirmedFactCount: confirmed, activeResumeMaterialId: ctx.evidence.activeResume?.id ?? null, activeResumeHash: ctx.evidence.activeResume?.contentHash ?? null,
      providerId: provider.id, rulesVersion: provider.version, inputHash: hash, components: ctx.components
    };
    return tx.opportunityAssessment.create({ data: {
      workspaceId: ws, opportunityId: ctx.opportunity.id, profileId: ctx.evidence.profile.id, providerId: provider.id, providerVersion: provider.version, inputHash: hash,
      score: out.score, confidence: out.confidence, inputs: json(inputs),
      result: json({ breakdown: out.breakdown, criteria: out.criteria, conditions: out.conditions, unknowns: out.unknowns, autoSendBlockers: out.autoSendBlockers }), createdById: user
    } });
  }

  async assess(user: string, ws: string, input: CreateAssessmentInput): Promise<Assessment> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const ctx = await this.context(tx, user, ws, input.opportunityId, input.profileId);
      return this.assessmentDto(await this.ensureAssessmentTx(tx, user, ws, ctx, input.provider), ctx.components);
    });
  }

  async listAssessments(user: string, ws: string, q: { opportunityId?: string; profileId?: string; cursor?: string }) {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      if (q.cursor && !await tx.opportunityAssessment.findFirst({ where: { id: q.cursor, workspaceId: ws } })) throw new NotFoundException("Оценка не найдена");
      const rows = await tx.opportunityAssessment.findMany({ where: { workspaceId: ws, ...(q.opportunityId ? { opportunityId: q.opportunityId } : {}), ...(q.profileId ? { profileId: q.profileId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: PAGE + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
      const cache = new Map<string, Context>();
      const items: Assessment[] = [];
      for (const row of rows.slice(0, PAGE)) items.push(this.assessmentDto(row, (await this.liveContext(tx, user, ws, row.opportunityId, row.profileId, cache)).components));
      return { items, nextCursor: rows.length > PAGE ? rows[PAGE - 1].id : null };
    });
  }

  async getAssessment(user: string, ws: string, id: string): Promise<Assessment> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const row = await tx.opportunityAssessment.findFirst({ where: { id, workspaceId: ws } });
      if (!row) throw new NotFoundException("Оценка не найдена");
      return this.assessmentDto(row, (await this.context(tx, user, ws, row.opportunityId, row.profileId)).components);
    });
  }

  /* ---------------- Черновики ---------------- */

  private storedSections(row: DraftRow): StoredSection[] { return row.sections as unknown as StoredSection[]; }

  private draftDto(row: DraftRow, ctx: Context): Draft {
    const facts = new Map(ctx.evidence.facts.map((f) => [f.id, f]));
    const stored = this.storedSections(row);
    const sections = stored.map((s) => ({ id: s.id, text: s.text, factIds: s.factIds, origin: s.origin, basis: sectionBasis(s, facts), requirementId: s.requirementId, hint: s.hint }));
    const materials = row.materials as unknown as MaterialRef[];
    const text = draftText(stored);
    const textHash = textHashOf(text, materials);
    const reasons = staleReasons(this.componentsOf(row), ctx.components);
    if (row.templateVersion !== DRAFT_TEMPLATE_VERSION) reasons.push("Изменилась версия шаблона черновика");
    const stale = reasons.length > 0;
    const approvalValid = row.reviewState === "approved" && row.approvedTextHash === textHash && !stale;
    const blockers: string[] = [];
    if (stale) blockers.push("Исходные данные изменились после подготовки черновика — подготовьте новый.");
    for (const s of sections) {
      if (s.basis === "unverified") blockers.push(`Раздел опирается на факт, который больше не подтверждён: «${s.text.slice(0, 80)}»`);
      if (s.basis === "empty" && s.hint) blockers.push(`Раздел без подтверждённых сведений: ${s.hint.slice(0, 120)}`);
    }
    if (!text.trim()) blockers.push("Текст пуст.");
    return draftSchema.parse({
      id: row.id, workspaceId: row.workspaceId, opportunityId: row.opportunityId, profileId: row.profileId, assessmentId: row.assessmentId, kind: row.kind, question: row.question,
      sections, notes: row.notes, text, textHash, materials, reviewState: row.reviewState, approvedBy: row.approvedBy, approvedAt: row.approvedAt?.toISOString() ?? null,
      approvalValid, blockers, stale, staleReasons: reasons, templateVersion: row.templateVersion, revision: row.revision, createdBy: row.createdById, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    });
  }

  /** Колонка `inputHash` черновика хранит JSON с хэшами частей входных данных на момент подготовки (для оценки это отдельное поле `inputs.components`). */
  private componentsOf(row: DraftRow): Components {
    try { return JSON.parse(row.inputHash) as Components; } catch { return { opportunity: "", preferences: "", facts: "", tracks: "", resume: "" }; }
  }

  private async loadDraft(tx: Tx, ws: string, id: string): Promise<DraftRow> {
    const row = await tx.opportunityDraft.findFirst({ where: { id, workspaceId: ws } });
    if (!row) throw new NotFoundException("Черновик не найден");
    return row;
  }

  private async draftWithContext(tx: Tx, user: string, ws: string, row: DraftRow, cache = new Map<string, Context>()): Promise<{ dto: Draft; ctx: Context }> {
    const ctx = await this.liveContext(tx, user, ws, row.opportunityId, row.profileId, cache);
    return { dto: this.draftDto(row, ctx), ctx };
  }

  async createDraft(user: string, ws: string, input: CreateDraftInput): Promise<Draft> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      return this.createDraftTx(tx, user, ws, input);
    });
  }

  private async createDraftTx(tx: Tx, user: string, ws: string, input: CreateDraftInput): Promise<Draft> {
    const ctx = await this.context(tx, user, ws, input.opportunityId, input.profileId);
    const assessment = await this.ensureAssessmentTx(tx, user, ws, ctx, "rules-v1");
    const criteria = (assessment.result as unknown as { criteria: Assessment["criteria"] }).criteria;
    const generated = generateDraft({ kind: input.kind, question: input.question, opportunity: ctx.opportunity, evidence: ctx.evidence, criteria });
    const materials: MaterialRef[] = ctx.evidence.activeResume ? [{ id: ctx.evidence.activeResume.id, title: ctx.evidence.activeResume.title, type: ctx.evidence.activeResume.type, contentHash: ctx.evidence.activeResume.contentHash }] : [];
    const text = draftText(generated.sections);
    const row = await tx.opportunityDraft.create({ data: {
      workspaceId: ws, opportunityId: input.opportunityId, profileId: input.profileId, assessmentId: assessment.id, kind: input.kind, question: input.question ?? null,
      sections: json(generated.sections), notes: json(generated.notes), materials: json(materials), inputHash: JSON.stringify(ctx.components), textHash: textHashOf(text, materials),
      templateVersion: DRAFT_TEMPLATE_VERSION, createdById: user
    } });
    return this.draftDto(row, ctx);
  }

  async listDrafts(user: string, ws: string, q: { opportunityId?: string; cursor?: string }) {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      if (q.cursor && !await tx.opportunityDraft.findFirst({ where: { id: q.cursor, workspaceId: ws } })) throw new NotFoundException("Черновик не найден");
      const rows = await tx.opportunityDraft.findMany({ where: { workspaceId: ws, ...(q.opportunityId ? { opportunityId: q.opportunityId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: PAGE + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
      const cache = new Map<string, Context>(); const items: Draft[] = [];
      for (const row of rows.slice(0, PAGE)) items.push((await this.draftWithContext(tx, user, ws, row, cache)).dto);
      return { items, nextCursor: rows.length > PAGE ? rows[PAGE - 1].id : null };
    });
  }

  async getDraft(user: string, ws: string, id: string): Promise<Draft> {
    return this.prisma.withUser(user, async (tx) => { await this.guard(tx, user, ws); return (await this.draftWithContext(tx, user, ws, await this.loadDraft(tx, ws, id))).dto; });
  }

  async updateDraft(user: string, ws: string, id: string, input: UpdateDraftInput): Promise<Draft> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const row = await this.loadDraft(tx, ws, id);
      if (row.revision !== input.expectedRevision) throw new ConflictException("Черновик изменён в другом окне. Обновите его.");
      const ctx = await this.context(tx, user, ws, row.opportunityId, row.profileId);
      const known = new Set(ctx.evidence.facts.map((f) => f.id));
      const existing = new Map(this.storedSections(row).map((s) => [s.id, s]));
      for (const s of input.sections) for (const factId of s.factIds) if (!known.has(factId)) throw new NotFoundException("Один из фактов не принадлежит профилю этого черновика или находится в архиве");
      const sections: StoredSection[] = input.sections.map((s) => {
        const prev = existing.get(s.id);
        const sameFacts = !!prev && prev.factIds.length === s.factIds.length && prev.factIds.every((f) => s.factIds.includes(f));
        return { id: s.id, text: s.text, factIds: s.factIds, origin: prev && sameFacts ? prev.origin : "manual", generatedText: prev?.generatedText ?? "", requirementId: prev?.requirementId ?? null, hint: prev?.hint ?? "" };
      });
      const materials = row.materials as unknown as MaterialRef[];
      const changed = await tx.opportunityDraft.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision }, data: {
        sections: json(sections), textHash: textHashOf(draftText(sections), materials), reviewState: "draft", approvedBy: null, approvedAt: null, approvedTextHash: null, revision: { increment: 1 }
      } });
      if (!changed.count) throw new ConflictException("Черновик изменён в другом окне. Обновите его.");
      return this.draftDto(await this.loadDraft(tx, ws, id), ctx);
    });
  }

  async approve(user: string, ws: string, id: string, input: ReviewDraftInput): Promise<Draft> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws, true);
      return this.approveCoreTx(tx, user, ws, id, input, user);
    });
  }

  /** Общая часть одобрения. `approver` — пользователь или ссылка на политику (`policy:<id>`), попадает в `approvedBy`. */
  private async approveCoreTx(tx: Tx, user: string, ws: string, id: string, input: ReviewDraftInput, approver: string): Promise<Draft> {
    const row = await this.loadDraft(tx, ws, id);
    if (row.revision !== input.expectedRevision) throw new ConflictException("Черновик изменён в другом окне. Обновите его.");
    if (row.reviewState === "rejected") throw new ConflictException("Черновик отклонён. Подготовьте новый или отредактируйте этот.");
    const ctx = await this.context(tx, user, ws, row.opportunityId, row.profileId);
    const current = this.draftDto(row, ctx);
    if (current.textHash !== input.textHash) throw new ConflictException("Текст изменился с момента просмотра. Откройте актуальный текст перед одобрением.");
    if (current.stale) throw new ConflictException("Исходные данные изменились после подготовки черновика. Подготовьте новый.");
    if (!current.text.trim()) throw new BadRequestException("Нельзя одобрить пустой текст.");
    if (current.sections.some((s) => s.basis === "unverified" || (s.basis === "empty" && s.hint))) throw new ConflictException("В черновике есть разделы без подтверждённых сведений. Подтвердите факты или напишите эти разделы сами.");
    if (current.sections.some((s) => s.basis === "manual") && !input.acknowledgeManualSections) throw new ConflictException("Есть разделы, изменённые вручную: подтвердите, что проверили их достоверность.");
    const changed = await tx.opportunityDraft.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision }, data: { reviewState: "approved", approvedBy: approver, approvedAt: new Date(), approvedTextHash: current.textHash, revision: { increment: 1 } } });
    if (!changed.count) throw new ConflictException("Черновик изменён в другом окне. Обновите его.");
    return this.draftDto(await this.loadDraft(tx, ws, id), ctx);
  }

  /* ---------------- Порт автоматизации (ИИ-менеджер) ---------------- */

  async assessTx(tx: Tx, user: string, ws: string, opportunityId: string, profileId: string): Promise<Assessment> {
    await this.guard(tx, user, ws, true);
    const ctx = await this.context(tx, user, ws, opportunityId, profileId);
    return this.assessmentDto(await this.ensureAssessmentTx(tx, user, ws, ctx, "rules-v1"), ctx.components);
  }

  async createResponseDraftTx(tx: Tx, user: string, ws: string, opportunityId: string, profileId: string, kind: "response" | "proposal"): Promise<Draft> {
    await this.guard(tx, user, ws, true);
    return this.createDraftTx(tx, user, ws, { opportunityId, profileId, kind });
  }

  async approveForPolicyTx(tx: Tx, user: string, ws: string, draftId: string, approverRef: string): Promise<Draft> {
    await this.guard(tx, user, ws, true);
    const row = await this.loadDraft(tx, ws, draftId);
    const current = this.draftDto(row, await this.context(tx, user, ws, row.opportunityId, row.profileId));
    // Политика одобряет только то, что собрано из подтверждённых фактов; ручные разделы по политике не одобряются.
    return this.approveCoreTx(tx, user, ws, draftId, { expectedRevision: row.revision, textHash: current.textHash, acknowledgeManualSections: false }, approverRef);
  }

  async reject(user: string, ws: string, id: string, input: RejectDraftInput): Promise<Draft> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws, true);
      const row = await this.loadDraft(tx, ws, id);
      const ctx = await this.context(tx, user, ws, row.opportunityId, row.profileId);
      const changed = await tx.opportunityDraft.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision }, data: { reviewState: "rejected", approvedBy: null, approvedAt: null, approvedTextHash: null, revision: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Черновик изменён в другом окне. Обновите его.");
      return this.draftDto(await this.loadDraft(tx, ws, id), ctx);
    });
  }

  /** Пробный запуск: показывает ТОЧНЫЙ payload и причины, по которым его нельзя было бы отправить. Ничего не отправляет и не сохраняет. */
  async dryRun(user: string, ws: string, id: string): Promise<DryRun> {
    return this.prisma.withUser(user, async (tx) => { await this.guard(tx, user, ws); return this.dryRunTx(tx, user, ws, id); });
  }

  private async dryRunTx(tx: Tx, user: string, ws: string, id: string): Promise<DryRun> {
    const row = await this.loadDraft(tx, ws, id);
    const ctx = await this.context(tx, user, ws, row.opportunityId, row.profileId);
    const assessment = row.assessmentId ? await tx.opportunityAssessment.findFirst({ where: { id: row.assessmentId, workspaceId: ws } }) : null;
    const reviewNotes = assessment ? (assessment.result as unknown as { autoSendBlockers: string[] }).autoSendBlockers : [];
    const dto = this.draftDto(row, ctx);
    const blockers = [...dto.blockers];
    if (dto.reviewState !== "approved") blockers.push(dto.reviewState === "rejected" ? "Черновик отклонён." : "Текст не одобрен владельцем.");
    else if (!dto.approvalValid && !dto.stale) blockers.push("Одобрение относилось к другому тексту — одобрите заново.");
    if (!dto.materials.length) blockers.push("Не выбрана версия резюме для отклика.");
    const payload = {
      recipient: { opportunityId: ctx.opportunity.id, title: ctx.opportunity.title, organizationName: ctx.opportunity.organizationName, url: ctx.opportunity.canonicalUrl, sourceType: ctx.opportunity.sourceType, externalId: ctx.opportunity.externalId },
      profile: { id: ctx.evidence.profile.id, displayName: ctx.evidence.profile.displayName }, text: dto.text, materials: dto.materials
    };
    return dryRunSchema.parse({
      mode: "dry_run", send: false, payload, payloadHash: sha256(stable(payload)), blockers: [...new Set(blockers)], reviewNotes: [...new Set(reviewNotes)],
      note: "Пробный запуск ничего не отправляет и не даёт права на отправку. Хэш показывает, какое содержимое было бы согласовано: любое изменение текста, резюме или адресата меняет его."
    });
  }

  /** Публичный порт для исполнителя: актуальный пробный запуск + состояние черновика в транзакции вызывающего. Права и включённость плагина проверяются здесь. */
  async readForExecutionTx(tx: Tx, user: string, ws: string, draftId: string): Promise<{ draft: Draft; dryRun: DryRun }> {
    await this.guard(tx, user, ws);
    const row = await this.loadDraft(tx, ws, draftId);
    const ctx = await this.context(tx, user, ws, row.opportunityId, row.profileId);
    return { draft: this.draftDto(row, ctx), dryRun: await this.dryRunTx(tx, user, ws, draftId) };
  }
}
