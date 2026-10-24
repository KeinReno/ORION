import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type SharedPublication as Row } from "@prisma/client";
import { createHash } from "node:crypto";
import { publicationContentSchema, publicationKindSchema, type CreatePublication, type PublicationSource, type PublicationStatusInput, type SharedPublication } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ModulesService } from "../modules/modules.service";
import { PublicationRegistry } from "./publication-registry";

@Injectable()
export class PublicationsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly modules: ModulesService, private readonly registry: PublicationRegistry) {}
  private module(kind: string) { return kind === "task" ? "tasks" as const : "knowledge" as const; }
  private async source(tx: Prisma.TransactionClient, userId: string, source: PublicationSource) {
    await this.workspaces.assertMemberRoleTx(tx, userId, source.sourceWorkspaceId, ["owner"]);
    await this.modules.assertEnabledTx(tx, userId, source.sourceWorkspaceId, this.module(source.kind));
    const result = await this.registry.get(source.kind).read(tx, source);
    const parsed = publicationContentSchema.safeParse(result.content);
    if (!parsed.success) throw new BadRequestException("После удаления ссылок материал не подходит для публикации. Проверьте название и длину текста оригинала");
    const content = parsed.data;
    return { content, sourceRevision: result.revision, fingerprint: createHash("sha256").update(JSON.stringify({ source, content, revision: result.revision })).digest("hex") };
  }
  preview(userId: string, source: PublicationSource) { return this.prisma.withUser(userId, tx => this.source(tx, userId, source)); }
  async create(userId: string, input: CreatePublication) {
    try {
      return await this.prisma.withUser(userId, async tx => {
        await this.workspaces.assertMemberTx(tx, userId, input.workspaceId);
        await this.modules.assertEnabledTx(tx, userId, input.workspaceId, this.module(input.kind));
        const zone = await tx.workspace.findUniqueOrThrow({ where: { id: input.workspaceId } });
        if (zone.isPersonal || input.workspaceId === input.sourceWorkspaceId) throw new BadRequestException("Выберите отдельное общее пространство");
        if (input.kind !== "task" && input.allowStatus) throw new BadRequestException("Изменение статуса доступно только для задач");
        const source: PublicationSource = { sourceWorkspaceId: input.sourceWorkspaceId, sourceId: input.sourceId, kind: input.kind, includeText: input.includeText, includeDueAt: input.includeDueAt };
        const preview = await this.source(tx, userId, source);
        if (preview.fingerprint !== input.fingerprint) throw new ConflictException("Оригинал изменился. Обновите предварительный просмотр");
        const row = await tx.sharedPublication.create({ data: { workspaceId: input.workspaceId, publisherId: userId, ...source, sourceRevision: preview.sourceRevision, content: preview.content as Prisma.InputJsonValue, allowStatus: input.allowStatus } });
        return this.dto(row, userId);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Материал уже опубликован в этой зоне");
      throw error;
    }
  }
  list(userId: string, workspaceId: string) {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const allowed = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const rows = await tx.sharedPublication.findMany({ where: { workspaceId, revokedAt: null }, orderBy: { updatedAt: "desc" }, take: 200 });
      return rows.filter(row => allowed.has(this.module(row.kind))).map(row => this.dto(row, userId));
    });
  }
  issued(userId: string) { return this.prisma.withUser(userId, async tx => (await tx.sharedPublication.findMany({ where: { publisherId: userId, revokedAt: null }, orderBy: { updatedAt: "desc" }, take: 200 })).map(row => this.dto(row, userId))); }
  private async active(tx: Prisma.TransactionClient, userId: string, id: string, lock = false) {
    if (lock) await tx.$queryRaw`SELECT id FROM shared_publications WHERE id = ${id} FOR UPDATE`;
    const row = await tx.sharedPublication.findFirst({ where: { id, revokedAt: null } });
    if (!row) throw new NotFoundException("Публикация недоступна или доступ отозван");
    await tx.$queryRaw`SELECT id FROM workspace_members WHERE "workspaceId" = ${row.workspaceId} AND "userId" = ${userId} FOR SHARE`;
    await this.workspaces.assertMemberTx(tx, userId, row.workspaceId);
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${row.workspaceId} FOR SHARE`;
    await this.modules.assertEnabledTx(tx, userId, row.workspaceId, this.module(row.kind));
    return row;
  }
  get(userId: string, id: string) { return this.prisma.withUser(userId, async tx => this.dto(await this.active(tx, userId, id), userId)); }
  private sourceOf(row: Row): PublicationSource {
    return { sourceWorkspaceId: row.sourceWorkspaceId, sourceId: row.sourceId, kind: publicationKindSchema.parse(row.kind), includeText: row.includeText, includeDueAt: row.includeDueAt };
  }
  refreshPreview(userId: string, id: string) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.active(tx, userId, id);
      if (row.publisherId !== userId) throw new ForbiddenException("Обновлять публикацию может только её владелец");
      return this.source(tx, userId, this.sourceOf(row));
    });
  }
  refresh(userId: string, id: string, input: { expectedRevision: number; fingerprint: string }) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.active(tx, userId, id, true);
      if (row.publisherId !== userId) throw new ForbiddenException("Обновлять публикацию может только её владелец");
      const preview = await this.source(tx, userId, this.sourceOf(row));
      if (row.revision !== input.expectedRevision || preview.fingerprint !== input.fingerprint) throw new ConflictException("Данные изменились. Повторите предварительный просмотр");
      return this.dto(await tx.sharedPublication.update({ where: { id }, data: { content: preview.content as Prisma.InputJsonValue, sourceRevision: preview.sourceRevision, revision: { increment: 1 } } }), userId);
    });
  }
  status(userId: string, id: string, input: PublicationStatusInput) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.active(tx, userId, id, true);
      if (!row.allowStatus || row.kind !== "task") throw new ForbiddenException("Публикация доступна только для чтения");
      const previous = await tx.sharedPublicationOperation.findUnique({ where: { id: input.operationId } });
      if (previous) {
        if (previous.actorId !== userId || previous.publicationId !== id || previous.status !== input.status || previous.expectedRevision !== input.expectedRevision) throw new ConflictException("Идентификатор операции уже использован");
        return this.dto(row, userId);
      }
      if (row.revision !== input.expectedRevision) throw new ConflictException("Публикация изменилась. Обновите её и повторите действие");
      // Narrow delegation: publisher explicitly allowed this field. Recheck their current source authority.
      // The entire source write, publication revision and idempotency record commit together.
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${row.publisherId}, true)`;
      try {
        await tx.$queryRaw`SELECT id FROM workspace_members WHERE "workspaceId" IN (${row.sourceWorkspaceId}, ${row.workspaceId}) AND "userId" = ${row.publisherId} ORDER BY id FOR SHARE`;
        await this.workspaces.assertMemberTx(tx, row.publisherId, row.workspaceId);
        await this.workspaces.assertMemberRoleTx(tx, row.publisherId, row.sourceWorkspaceId, ["owner"]);
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${row.sourceWorkspaceId} FOR SHARE`;
        await this.modules.assertEnabledTx(tx, row.publisherId, row.sourceWorkspaceId, "tasks");
        const adapter = this.registry.get("task");
        if (!adapter.changeStatus) throw new ForbiddenException("Модуль не поддерживает изменение статуса");
        const source: PublicationSource = { sourceWorkspaceId: row.sourceWorkspaceId, sourceId: row.sourceId, kind: "task", includeText: row.includeText, includeDueAt: row.includeDueAt };
        // Do not expose the task service's conflict DTO (it contains private source fields).
        let sourceRevision: number;
        try { sourceRevision = await adapter.changeStatus(tx, row.publisherId, source, row.sourceRevision, input.status, `Общая публикация ${id}; участник ${userId}`); }
        catch (error) {
          if (error instanceof ConflictException || error instanceof NotFoundException) throw new ConflictException("Оригинал изменился или недоступен. Владелец должен проверить публикацию");
          throw error;
        }
        const content = publicationContentSchema.parse(row.content);
        const updated = await tx.sharedPublication.update({ where: { id }, data: { content: { ...content, status: input.status }, sourceRevision, revision: { increment: 1 } } });
        await tx.sharedPublicationOperation.create({ data: { id: input.operationId, publicationId: id, workspaceId: row.workspaceId, actorId: userId, status: input.status, expectedRevision: input.expectedRevision, resultRevision: updated.revision } });
        return this.dto(updated, userId);
      } finally { await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`; }
    });
  }
  revoke(userId: string, id: string) {
    return this.prisma.withUser(userId, async tx => {
      await tx.$queryRaw`SELECT id FROM shared_publications WHERE id = ${id} FOR UPDATE`;
      const row = await tx.sharedPublication.findFirst({ where: { id, publisherId: userId } });
      if (!row) throw new NotFoundException("Публикация недоступна");
      await tx.sharedPublication.update({ where: { id }, data: { revokedAt: row.revokedAt ?? new Date(), revision: { increment: 1 } } });
      return { revoked: true };
    });
  }
  pin(userId: string, id: string, workspaceId: string) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.active(tx, userId, id, true);
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, this.module(row.kind));
      await tx.sharedPublicationPin.upsert({ where: { userId_workspaceId_publicationId: { userId, workspaceId, publicationId: id } }, create: { userId, workspaceId, publicationId: id }, update: {} });
      return this.dto(row, userId);
    });
  }
  unpin(userId: string, id: string, workspaceId: string) { return this.prisma.withUser(userId, async tx => { await tx.sharedPublicationPin.deleteMany({ where: { userId, workspaceId, publicationId: id } }); return { removed: true }; }); }
  pinned(userId: string, workspaceId: string) {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const pins = await tx.sharedPublicationPin.findMany({ where: { userId, workspaceId }, take: 200 });
      const result: SharedPublication[] = [];
      for (const pin of pins) {
        try {
          const row = await this.active(tx, userId, pin.publicationId);
          await this.modules.assertEnabledTx(tx, userId, workspaceId, this.module(row.kind));
          result.push(this.dto(row, userId));
        } catch (error) { if (!(error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ConflictException)) throw error; }
      }
      return result;
    });
  }
  copy(userId: string, id: string, workspaceId: string) {
    return this.prisma.withUser(userId, async tx => {
      const row = await this.active(tx, userId, id, true);
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const destination = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      if (!destination.isPersonal) throw new BadRequestException("Выберите личное пространство для независимой копии");
      await this.modules.assertEnabledTx(tx, userId, workspaceId, this.module(row.kind));
      const content = publicationContentSchema.parse(row.content);
      const text = `${content.text}\n\nИсточник: общая публикация ${row.id}. Самостоятельная копия.`;
      if (text.length > (row.kind === "task" ? 20000 : 100000)) throw new BadRequestException("Текст слишком большой для копии с отметкой происхождения");
      const kind = publicationKindSchema.parse(row.kind);
      const copiedId = await this.registry.get(kind).copy(tx, userId, workspaceId, { ...content, text });
      return { id: copiedId, workspaceId, kind };
    });
  }
  private dto(row: Row, userId: string): SharedPublication {
    return { id: row.id, workspaceId: row.workspaceId, kind: publicationKindSchema.parse(row.kind), content: publicationContentSchema.parse(row.content), revision: row.revision, allowStatus: row.allowStatus, canManage: row.publisherId === userId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
}
