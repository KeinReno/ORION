import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { OpportunityImport, Prisma } from "@prisma/client";
import { hhImportRunSchema, hhImportReportSchema, type HhImportPreviewInput, type HhImportApplyInput, type HhImportReport } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { PluginsService } from "../plugins/plugins.service";
import { OPPORTUNITIES_IMPORT_PORT, type OpportunitiesImportPort } from "../opportunities/public";
import { PROFILE_IMPORT_PORT, type ProfileImportPort } from "../opportunities-profiles/public";
import { compileHhPlan, contentHash, type HhPlan } from "./hh-parser";
const emptyReport = (): HhImportReport => ({ opportunitiesCreated: 0, opportunitiesExisting: 0, capturesCreated: 0, profilesCreated: 0, materialsCreated: 0, materialsExisting: 0, historyCreated: 0, historyExisting: 0, possibleDuplicates: 0 });
const json = (value: unknown) => value as Prisma.InputJsonValue;
function dto(row: OpportunityImport) {
  const plan = row.plan as unknown as HhPlan;
  return hhImportRunSchema.parse({ id: row.id, workspaceId: row.workspaceId, manifestHash: row.manifestHash, revision: row.revision, status: row.status, checkpoint: row.checkpoint, total: plan.operations.length, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), preview: row.preview, report: row.report });
}
@Injectable()
export class HhImportService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly plugins: PluginsService,
    @Inject(OPPORTUNITIES_IMPORT_PORT) private readonly opportunities: OpportunitiesImportPort,
    @Inject(PROFILE_IMPORT_PORT) private readonly profiles: ProfileImportPort) {}
  private async guard(tx: Prisma.TransactionClient, user: string, ws: string) {
    await this.workspaces.assertMemberRoleTx(tx, user, ws, ["owner"]);
    await this.plugins.assertEnabledTx(tx, user, ws, "opportunities-hh-import");
  }
  private async owned(tx: Prisma.TransactionClient, ws: string, id: string) {
    const row = await tx.opportunityImport.findFirst({ where: { id, workspaceId: ws } });
    if (!row) throw new NotFoundException("Импорт не найден"); return row;
  }
  async preview(user: string, ws: string, input: HhImportPreviewInput) {
    const plan = compileHhPlan(input);
    if (!plan.operations.length) throw new BadRequestException({ message: "Нет поддерживаемых записей для импорта", warnings: plan.warnings });
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      if (input.includeProfiles) await this.plugins.assertEnabledTx(tx, user, ws, "opportunities-profiles");
      if (input.historyProfileId) await this.profiles.assertImportTargetTx(tx, user, ws, input.historyProfileId);
      const preview = { opportunities: plan.operations.filter((o) => o.kind === "opportunity").length, materials: plan.operations.filter((o) => o.kind === "material").length, history: plan.operations.filter((o) => o.kind === "history").length,
        candidateNames: [...new Set(plan.operations.flatMap((o) => o.kind === "material" ? [o.data.candidateName] : []))], samples: plan.operations.slice(0, 20).map((o) => ({ title: o.kind === "opportunity" ? o.data.input.title : o.data.title, sourcePath: o.data.sourcePath })), warnings: plan.warnings };
      return dto(await tx.opportunityImport.create({ data: { workspaceId: ws, createdById: user, manifestHash: contentHash(JSON.stringify(input)), plan: json(plan), preview: json(preview), report: emptyReport(), expiresAt: new Date(Date.now() + 86400000) } }));
    });
  }
  async recent(user: string, ws: string) { return this.prisma.withUser(user, async (tx) => { await this.guard(tx, user, ws); return (await tx.opportunityImport.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 20 })).map(dto); }); }
  async get(user: string, ws: string, id: string) { return this.prisma.withUser(user, async (tx) => { await this.guard(tx, user, ws); return dto(await this.owned(tx, ws, id)); }); }
  async change(user: string, ws: string, id: string, input: HhImportApplyInput, cancel = false) {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      // Lock is scoped and follows membership checks. Checkpoint/report and inserted rows commit together.
      await tx.$queryRaw`SELECT id FROM opportunity_imports WHERE id = ${id} AND "workspaceId" = ${ws} FOR UPDATE`;
      const row = await this.owned(tx, ws, id);
      if (row.manifestHash !== input.manifestHash) throw new ConflictException("Другой manifest. Создайте новый предпросмотр.");
      if (row.status === "applied" && !cancel) return dto(row);
      if (row.status === "canceled" || row.status === "applied") throw new ConflictException("Импорт уже завершён или отменён");
      if (row.revision !== input.expectedRevision) throw new ConflictException("Импорт изменён в другом окне. Обновите его состояние.");
      if (cancel) return dto(await tx.opportunityImport.update({ where: { id }, data: { status: "canceled", revision: { increment: 1 } } }));
      if (row.expiresAt <= new Date()) throw new ConflictException("Предпросмотр истёк. Создайте новый.");
      const plan = row.plan as unknown as HhPlan;
      if (plan.version !== 1) throw new ConflictException("Версия импорта не поддерживается");
      if (plan.includeProfiles) await this.plugins.assertEnabledTx(tx, user, ws, "opportunities-profiles");
      if (plan.historyProfileId) await this.profiles.assertImportTargetTx(tx, user, ws, plan.historyProfileId);
      const report = hhImportReportSchema.parse(row.report);
      const end = Math.min(row.checkpoint + 25, plan.operations.length);
      for (const operation of plan.operations.slice(row.checkpoint, end)) {
        if (operation.kind === "material") {
          const result = await this.profiles.importMaterialTx(tx, user, ws, operation.data);
          report.profilesCreated += Number(result.profileCreated);
          report.materialsCreated += Number(result.materialCreated); report.materialsExisting += Number(!result.materialCreated);
        } else if (operation.kind === "opportunity") {
          const result = await this.opportunities.captureOpportunityTx(tx, user, ws, operation.data.input);
          report.opportunitiesCreated += Number(result.created); report.opportunitiesExisting += Number(!result.created);
          const count = await tx.opportunityCapture.createMany({ skipDuplicates: true, data: [{ workspaceId: ws, opportunityId: result.id, importRunId: id, sourcePath: operation.data.sourcePath, fileHash: operation.data.fileHash, contentHash: operation.data.contentHash, snapshot: operation.data.snapshot, historical: true }] });
          report.capturesCreated += count.count;
        } else {
          const data = operation.data;
          const recordHash = contentHash(`${plan.historyProfileId ?? "unassigned"}:${data.recordHash}`);
          const opportunityId = data.externalId ? await this.opportunities.resolveExternalTx(tx, user, ws, "hh", data.externalId) : null;
          const possibleDuplicate = !!await tx.opportunityHistory.findFirst({ where: { workspaceId: ws, recordHash: { not: recordHash }, profileId: plan.historyProfileId, ...(data.externalId ? { externalId: data.externalId } : { title: data.title }), sourceTime: data.sourceTime } });
          const count = await tx.opportunityHistory.createMany({ skipDuplicates: true, data: [{ ...data, recordHash, workspaceId: ws, opportunityId, profileId: plan.historyProfileId, importRunId: id, possibleDuplicate }] });
          report.historyCreated += count.count; report.historyExisting += Number(!count.count); report.possibleDuplicates += count.count ? Number(possibleDuplicate) : 0;
        }
      }
      return dto(await tx.opportunityImport.update({ where: { id }, data: { checkpoint: end, status: end === plan.operations.length ? "applied" : "applying", report, revision: { increment: 1 } } }));
    });
  }
  async sources(user: string, ws: string, opportunityId: string) {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      await this.opportunities.assertOpportunityTx(tx, user, ws, opportunityId);
      const captures = await tx.opportunityCapture.findMany({ where: { workspaceId: ws, opportunityId }, orderBy: { capturedAt: "desc" }, take: 50 });
      const history = await tx.opportunityHistory.findMany({ where: { workspaceId: ws, opportunityId }, orderBy: { createdAt: "desc" }, take: 50 });
      return { captures: captures.map((r) => ({ id: r.id, sourcePath: r.sourcePath, fileHash: r.fileHash, contentHash: r.contentHash, snapshot: r.snapshot, historical: r.historical, capturedAt: r.capturedAt.toISOString() })), history: history.map((r) => ({ id: r.id, profileId: r.profileId, title: r.title, outcome: r.outcome, originalStatus: r.originalStatus, reason: r.reason, sourceTime: r.sourceTime, sourcePath: r.sourcePath, possibleDuplicate: r.possibleDuplicate })), limit: 50 };
    });
  }
}
