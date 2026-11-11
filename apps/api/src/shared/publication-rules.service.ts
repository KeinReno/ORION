import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma, type PublicationRule as Row } from "@prisma/client";
import { createHash } from "node:crypto";
import { parseDomainEventPayload, publicationContentSchema, publicationRuleConfigSchema, type PublicationRule, type PublicationRuleConfig, type PublicationRuleEnable, type PublicationRulePreview } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { BackgroundJobsService } from "../common/background-jobs.service";
import { DomainEventBus, restoreSystemRole } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ModulesService } from "../modules/modules.service";
import { PublicationRegistry } from "./publication-registry";

const LIMIT = 100;
type Tx = Prisma.TransactionClient;
type Counts = { published: number; updated: number; withdrawn: number };

/** Platform exchange policies. All domain reads go through registered source adapters. */
@Injectable()
export class PublicationRulesService implements OnModuleInit {
  private cursor = "";
  constructor(private readonly prisma: PrismaService, private readonly registry: PublicationRegistry,
    private readonly workspaces: WorkspacesService, private readonly modules: ModulesService,
    private readonly bus: DomainEventBus, private readonly jobs: BackgroundJobsService) {}

  onModuleInit() {
    this.bus.subscribe({ id: "tasks.publish-selected-tasks", componentId: "tasks", types: ["tasks.task.changed"],
      handle: async (event, tx) => {
        if (event.type !== "tasks.task.changed") return;
        const { id } = parseDomainEventPayload("tasks.task.changed", event.payload);
        const rows = await tx.publicationRule.findMany({ where: { workspaceId: event.workspaceId, enabled: true }, select: { id: true } });
        for (const row of rows) await this.backgroundTx(tx, row.id, id, true);
      }
    });
  }

  private dto(row: Row): PublicationRule {
    return { id: row.id, config: publicationRuleConfigSchema.parse(row.config), enabled: row.enabled, revision: row.revision,
      lastRunAt: row.lastRunAt?.toISOString() ?? null, lastError: row.lastError,
      history: row.history as unknown as PublicationRule["history"] };
  }
  private async authority(tx: Tx, userId: string, config: PublicationRuleConfig) {
    // Parent/member locks before rule/publication locks; permission changes cannot
    // commit halfway through a publication. Consistent workspace order avoids inversion.
    const ids = [config.sourceWorkspaceId, config.workspaceId].sort();
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM workspace_members WHERE "workspaceId" IN (${Prisma.join(ids)}) AND "userId" = ${userId} ORDER BY id FOR SHARE`;
    await this.workspaces.assertMemberRoleTx(tx, userId, config.sourceWorkspaceId, ["owner"]);
    await this.workspaces.assertMemberTx(tx, userId, config.workspaceId);
    await this.modules.assertEnabledTx(tx, userId, config.sourceWorkspaceId, "tasks");
    await this.modules.assertEnabledTx(tx, userId, config.workspaceId, "tasks");
    const target = await tx.workspace.findUnique({ where: { id: config.workspaceId } });
    if (!target || target.isPersonal || config.sourceWorkspaceId === config.workspaceId) throw new ForbiddenException("Нужна отдельная общая зона");
  }
  private async owned(tx: Tx, userId: string, id: string, lock = false) {
    const row = await tx.publicationRule.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException("Правило недоступно");
    if (lock) {
      await this.authority(tx, userId, publicationRuleConfigSchema.parse(row.config));
      await tx.$queryRaw`SELECT id FROM publication_rules WHERE id = ${id} FOR UPDATE`;
      return tx.publicationRule.findUniqueOrThrow({ where: { id } });
    }
    return row;
  }
  private cas(row: Row, revision: number) { if (row.revision !== revision) throw new ConflictException("Правило изменилось. Обновите его"); }
  private history(row: Row, action: string, counts?: Counts | { fingerprint: string; consentFutureRecords: true }): Prisma.InputJsonValue {
    const previous = Array.isArray(row.history) ? row.history : [];
    const recent = [...previous.slice(-19), { at: new Date().toISOString(), action, ...counts }];
    // Periodic passes must not evict the latest explicit future-record consent.
    const consent = previous.filter(value => value && typeof value === "object" && !Array.isArray(value) && value.action === "enabled").at(-1);
    if (action !== "enabled" && consent && !recent.includes(consent)) recent[0] = consent;
    return recent as Prisma.InputJsonValue;
  }
  private content(value: unknown) {
    const parsed = publicationContentSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException("После удаления приватных ссылок материал не подходит для публикации. Проверьте оригинал");
    return parsed.data;
  }
  private candidates(tx: Tx, config: PublicationRuleConfig, id?: string) {
    const adapter = this.registry.get("task");
    if (!adapter.ruleCandidates) throw new BadRequestException("Модуль не поддерживает правила публикации");
    return adapter.ruleCandidates(tx, config, id);
  }
  async create(userId: string, config: PublicationRuleConfig) {
    return this.prisma.withUser(userId, async tx => {
      await this.authority(tx, userId, config);
      return this.dto(await tx.publicationRule.create({ data: { workspaceId: config.sourceWorkspaceId, targetWorkspaceId: config.workspaceId,
        userId, config: config as Prisma.InputJsonValue, history: [{ at: new Date().toISOString(), action: "created" }] } }));
    });
  }
  list(userId: string) { return this.prisma.withUser(userId, async tx => (await tx.publicationRule.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(row => this.dto(row))); }
  get(userId: string, id: string) { return this.prisma.withUser(userId, async tx => this.dto(await this.owned(tx, userId, id))); }
  edit(userId: string, id: string, revision: number, config: PublicationRuleConfig) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.owned(tx, userId, id, true); this.cas(row, revision);
      if (row.enabled) throw new ConflictException("Сначала остановите правило");
      if (config.sourceWorkspaceId !== row.workspaceId || config.workspaceId !== row.targetWorkspaceId) throw new BadRequestException("Для другого источника или получателя создайте новое правило");
      return this.dto(await tx.publicationRule.update({ where: { id }, data: { config: config as Prisma.InputJsonValue, revision: { increment: 1 }, history: this.history(row, "edited") } }));
    });
  }
  private async previewTx(tx: Tx, row: Row): Promise<PublicationRulePreview> {
    const config = publicationRuleConfigSchema.parse(row.config);
    await this.authority(tx, row.userId, config);
    const candidates = await this.candidates(tx, config);
    if (candidates.length > LIMIT) throw new BadRequestException("Больше 100 задач. Уточните фильтр перед включением правила");
    const existing = await tx.sharedPublication.findMany({ where: { workspaceId: config.workspaceId, publisherId: row.userId, kind: "task", sourceId: { in: candidates.map(item => item.sourceId) } }, orderBy: { id: "asc" } });
    const items = candidates.map(item => {
      const own = existing.find(p => p.ruleId === row.id && p.sourceId === item.sourceId);
      const other = existing.some(p => p.sourceId === item.sourceId && p.ruleId !== row.id && (p.ruleId === null || p.revokedAt === null));
      const action = own?.revokedAt || !own && other ? "excluded" as const : own ? "update" as const : "publish" as const;
      return { sourceId: item.sourceId, content: this.content(item.content), revision: item.revision, action };
    });
    const recipients = (await tx.workspaceMember.findMany({ where: { workspaceId: config.workspaceId, kind: "human", userId: { not: null } }, orderBy: { userId: "asc" }, select: { userId: true, role: true } }))
      .flatMap(member => (member.userId ? [{ userId: member.userId, role: member.role as string }] : []));
    const fingerprint = createHash("sha256").update(JSON.stringify({ id: row.id, revision: row.revision, config, items, recipients, existing: existing.map(p => ({ id: p.id, revision: p.revision, revokedAt: p.revokedAt })) })).digest("hex");
    return { count: items.length, publishableCount: items.filter(item => item.action !== "excluded").length, items: items.map(({ sourceId, content, action }) => ({ sourceId, content, action })), recipients, fingerprint };
  }
  preview(userId: string, id: string) { return this.prisma.withUser(userId, async tx => this.previewTx(tx, await this.owned(tx, userId, id))); }
  enable(userId: string, id: string, input: PublicationRuleEnable) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.owned(tx, userId, id, true); this.cas(row, input.expectedRevision);
      if (row.enabled) throw new ConflictException("Правило уже включено");
      if (input.consentFutureRecords !== true) throw new BadRequestException("Нужно согласие на будущие записи");
      if ((await this.previewTx(tx, row)).fingerprint !== input.fingerprint) throw new ConflictException("Данные или получатели изменились. Повторите предпросмотр");
      const active = await tx.publicationRule.update({ where: { id }, data: { enabled: true, revision: { increment: 1 }, history: this.history(row, "enabled", { fingerprint: input.fingerprint, consentFutureRecords: true }) } });
      await this.executeTx(tx, active);
      return this.dto(await tx.publicationRule.findUniqueOrThrow({ where: { id } }));
    });
  }
  pause(userId: string, id: string, revision: number) {
    return this.prisma.withUser(userId, async tx => {
      // Stopping must remain possible even if the destination/module is unavailable.
      const initial = await this.owned(tx, userId, id);
      await tx.$queryRaw`SELECT id FROM publication_rules WHERE id = ${id} FOR UPDATE`;
      const row = await this.owned(tx, userId, id); this.cas(row, revision);
      return this.dto(await tx.publicationRule.update({ where: { id: initial.id }, data: { enabled: false, revision: { increment: 1 }, history: this.history(row, "paused") } }));
    });
  }
  remove(userId: string, id: string, revision: number) {
    return this.prisma.withUser(userId, async tx => {
      await this.owned(tx, userId, id);
      await tx.$queryRaw`SELECT id FROM publication_rules WHERE id = ${id} FOR UPDATE`;
      const row = await this.owned(tx, userId, id); this.cas(row, revision);
      await tx.sharedPublication.updateMany({ where: { ruleId: id, publisherId: userId, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
      await tx.publicationRule.delete({ where: { id } });
      return { removed: true };
    });
  }
  run(userId: string, id: string, revision: number) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.owned(tx, userId, id, true); this.cas(row, revision);
      if (!row.enabled) throw new ConflictException("Правило остановлено");
      await this.executeTx(tx, row);
      return this.dto(await tx.publicationRule.findUniqueOrThrow({ where: { id } }));
    });
  }
  private async executeTx(tx: Tx, row: Row, sourceId?: string) {
    const config = publicationRuleConfigSchema.parse(row.config);
    const candidates = await this.candidates(tx, config, sourceId);
    if (candidates.length > LIMIT) throw new BadRequestException("Больше 100 задач. Остановите правило и уточните фильтр");
    const counts: Counts = { published: 0, updated: 0, withdrawn: 0 };
    const existing = await tx.sharedPublication.findMany({ where: { ruleId: row.id, ...(sourceId ? { sourceId } : {}) } });
    const selected = new Set(candidates.map(item => item.sourceId));
    for (const old of existing) {
      if (old.revokedAt || selected.has(old.sourceId)) continue;
      counts.withdrawn += (await tx.sharedPublication.updateMany({ where: { id: old.id, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } })).count;
    }
    for (const item of candidates) {
      const content = this.content(item.content);
      const old = existing.find(p => p.sourceId === item.sourceId);
      // Never resurrect a tombstone, or adopt somebody's manual publication.
      if (old?.revokedAt) continue;
      if (old) {
        await tx.$queryRaw`SELECT id FROM shared_publications WHERE id = ${old.id} FOR UPDATE`;
        const current = await tx.sharedPublication.findUniqueOrThrow({ where: { id: old.id } });
        const sameContent = JSON.stringify(this.content(current.content)) === JSON.stringify(content);
        if (current.revokedAt || current.sourceRevision > item.revision || current.sourceRevision === item.revision && sameContent && current.includeText === config.includeText && current.includeDueAt === config.includeDueAt && current.allowStatus === config.allowStatus) continue;
        await tx.sharedPublication.update({ where: { id: old.id }, data: { content: content as Prisma.InputJsonValue, sourceRevision: item.revision,
          includeText: config.includeText, includeDueAt: config.includeDueAt, allowStatus: config.allowStatus, revision: { increment: 1 } } });
        counts.updated++;
      } else {
        const manual = await tx.sharedPublication.findFirst({ where: { workspaceId: config.workspaceId, publisherId: row.userId, kind: "task", sourceId: item.sourceId, OR: [{ ruleId: null }, { revokedAt: null }] } });
        if (manual) {
          // Remember exclusion so later revocation of that manual publication
          // cannot turn into a fresh automatic grant on the next event.
          await tx.sharedPublication.create({ data: { ruleId: row.id, workspaceId: config.workspaceId, publisherId: row.userId, kind: "task",
            sourceWorkspaceId: row.workspaceId, sourceId: item.sourceId, sourceRevision: item.revision,
            content: content as Prisma.InputJsonValue, revokedAt: new Date() } });
          continue;
        }
        await tx.sharedPublication.create({ data: { ruleId: row.id, workspaceId: config.workspaceId, publisherId: row.userId, kind: "task",
          sourceWorkspaceId: row.workspaceId, sourceId: item.sourceId, sourceRevision: item.revision, content: content as Prisma.InputJsonValue,
          includeText: config.includeText, includeDueAt: config.includeDueAt, allowStatus: config.allowStatus } });
        counts.published++;
      }
    }
    await tx.publicationRule.update({ where: { id: row.id }, data: { lastRunAt: new Date(), lastError: null, history: this.history(row, "processed", counts) } });
  }

  /** Called only with a rule id enumerated by the dispatcher/job, never from a client. */
  private async backgroundTx(tx: Tx, id: string, sourceId?: string, retryDelivery = false) {
    const initial = await tx.publicationRule.findUnique({ where: { id } });
    if (!initial?.enabled) return;
    await tx.$executeRawUnsafe("SAVEPOINT publication_rule");
    try {
      await tx.$executeRawUnsafe("RESET ROLE");
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${initial.userId}, true)`;
      const config = publicationRuleConfigSchema.parse(initial.config);
      await this.authority(tx, initial.userId, config);
      await tx.$queryRaw`SELECT id FROM publication_rules WHERE id = ${id} FOR UPDATE`;
      const row = await tx.publicationRule.findUnique({ where: { id } });
      if (row?.enabled) await this.executeTx(tx, row, sourceId);
      await restoreSystemRole(tx);
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT publication_rule");
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT publication_rule");
      await restoreSystemRole(tx);
      // Fail closed on permission/module loss. Other failures remain retryable
      // through periodic reconciliation; store no private source/error DTO.
      const blocked = error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ConflictException;
      const row = await tx.publicationRule.findUnique({ where: { id } });
      if (row?.enabled) {
        if (blocked) await tx.sharedPublication.updateMany({ where: { ruleId: id, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
        await tx.publicationRule.update({ where: { id }, data: { enabled: blocked ? false : undefined, revision: blocked ? { increment: 1 } : undefined,
          lastRunAt: new Date(), lastError: blocked ? "Правило остановлено: проверьте права и доступность модулей" : "Не удалось выполнить правило. Повторите после проверки фильтра",
          history: this.history(row, blocked ? "blocked" : "failed") } });
      }
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT publication_rule");
      if (!blocked && retryDelivery) throw new Error("Не удалось выполнить правило публикации; требуется повтор доставки");
    } finally { await restoreSystemRole(tx); }
  }
  @Cron("*/30 * * * * *")
  async reconcile() {
    await this.jobs.runJob("core", "publication-rule-reconcile", async () => {
      const rows = await this.prisma.asSystem(tx => tx.publicationRule.findMany({ where: { enabled: true, id: { gt: this.cursor } }, orderBy: { id: "asc" }, take: 20, select: { id: true } }));
      for (const row of rows) await this.prisma.asSystem(tx => this.backgroundTx(tx, row.id));
      this.cursor = rows.length === 20 ? rows[rows.length - 1]!.id : "";
    });
  }
}
