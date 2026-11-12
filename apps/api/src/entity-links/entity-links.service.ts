import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  canonicalizeEndpoints,
  isPluginEnabled,
  isRelationPairAllowed,
  RELATION_CYCLE_KINDS,
  RELATION_KIND_CATALOG,
  wouldCreateRelationCycle,
  type CreateEntityLinkInput,
  type EntityLink,
  type EntityLinkPage,
  type RelationEndpoint,
  type RelationEdge,
  type RelationKind,
  type SearchableEntityType
} from "@orion/shared-types";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { ModulesService } from "../modules/modules.service";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ENTITY_REGISTRY } from "./entity-registry";

export interface EntityLinkPageOptions {
  cursor?: string;
  limit?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * Foundation Core (task 01.1): the ONE service that creates, reads and deletes generic
 * `entity_links`. Modules depend on this core service (or its public SDK
 * `EntityLinkOperations`) and never touch the table themselves.
 *
 * Invariants enforced in the same transaction as the write:
 *  - both endpoints exist and belong to THIS workspace (closed entity registry, no arbitrary tables);
 *  - no self-link;
 *  - relation kind is a closed enum from RELATION_KIND_CATALOG (never free text);
 *  - `depends_on` / `blocks` / `goal_prerequisite` cannot close a cycle (workspace row is locked);
 *  - a symmetric kind stores ONE canonical row; `bidirectional` is true for it;
 *  - creation/deletion publish `entity_link.created` / `entity_link.deleted` with {type, from, to}
 *    and actorId — that outbox row is the audit trail (who/when/what).
 */
@Injectable()
export class EntityLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly bus: DomainEventBus
  ) {}

  async list(userId: string, workspaceId: string, type: SearchableEntityType, id: string, page: EntityLinkPageOptions = {}): Promise<EntityLinkPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
      this.assertTypeAccessible(accessible, type);
      await this.entityTitleOrThrow(tx, workspaceId, type, id);

      const where: Prisma.EntityLinkWhereInput = { workspaceId, OR: [{ sourceType: type, sourceId: id }, { targetType: type, targetId: id }] };
      if (page.cursor) {
        const cursorRow = await tx.entityLink.findUnique({ where: { id: page.cursor }, select: { id: true, workspaceId: true, createdAt: true } });
        if (!cursorRow || cursorRow.workspaceId !== workspaceId) throw new BadRequestException("Курсор пагинации недействителен");
        where.AND = [{ OR: [{ createdAt: { lt: cursorRow.createdAt } }, { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } }] }];
      }

      const limit = Math.min(Math.max(1, page.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
      const rows = await tx.entityLink.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      const links: EntityLink[] = [];
      for (const row of pageRows) {
        const outgoing = row.sourceType === type && row.sourceId === id;
        const otherType = (outgoing ? row.targetType : row.sourceType) as SearchableEntityType;
        const otherId = outgoing ? row.targetId : row.sourceId;
        if (!accessible.has(otherType)) continue;
        const title = await this.entityTitle(tx, workspaceId, otherType, otherId);
        // Deleted endpoint: the owner of that entity removes links in its own transaction via
        // `EntityLinkOperations.removeForEntityTx`. Until then the dead row is hidden, never
        // rendered with a foreign title; deleting it here would invalidate the pagination cursor.
        if (title === null) continue;
        links.push(this.toDto(row, title));
      }
      return { items: links, nextCursor: hasMore ? pageRows[pageRows.length - 1]!.id : null };
    });
  }

  async create(userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.createLinkTx(tx, userId, workspaceId, input);
    });
  }

  /**
   * Body of `create()`, minus the `withUser` wrap. Callers (search create-and-link, other modules)
   * own the transaction and the leading `assertMemberTx`.
   */
  async createLinkTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink> {
    const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
    this.assertTypeAccessible(accessible, input.sourceType);
    this.assertTypeAccessible(accessible, input.targetType);

    if (input.sourceType === input.targetType && input.sourceId === input.targetId) {
      throw new BadRequestException("Нельзя связать объект с самим собой");
    }

    const kind: RelationKind = input.kind ?? "related_to";
    const definition = RELATION_KIND_CATALOG[kind];
    if (!isRelationPairAllowed(kind, input.sourceType, input.targetType)) {
      throw new BadRequestException("Недопустимая пара типов для этого вида связи");
    }
    // `bidirectional` has meaning only for symmetric kinds; directed kinds always keep direction.
    if (input.bidirectional === true && !definition.symmetric) {
      throw new BadRequestException("Флаг bidirectional допустим только для симметричного вида связи");
    }

    await this.entityTitleOrThrow(tx, workspaceId, input.sourceType, input.sourceId);
    const targetTitle = await this.entityTitleOrThrow(tx, workspaceId, input.targetType, input.targetId);

    if (RELATION_CYCLE_KINDS.has(kind)) {
      // Serialize dependency edits in this workspace: two concurrent requests could otherwise each
      // see an acyclic graph and commit a cycle together.
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      const edges = await tx.entityLink.findMany({ where: { workspaceId, kind }, select: { sourceType: true, sourceId: true, targetType: true, targetId: true } });
      const graph: RelationEdge[] = edges.map((edge) => ({
        source: { type: edge.sourceType as SearchableEntityType, id: edge.sourceId },
        target: { type: edge.targetType as SearchableEntityType, id: edge.targetId }
      }));
      const source: RelationEndpoint = { type: input.sourceType, id: input.sourceId };
      const target: RelationEndpoint = { type: input.targetType, id: input.targetId };
      if (wouldCreateRelationCycle(graph, source, target)) {
        const message = "Связь создаёт замкнутый круг зависимостей";
        // Legacy goal_prerequisite answered 400 before task 01; new generic kinds answer 409.
        if (kind === "goal_prerequisite") throw new BadRequestException(message);
        throw new ConflictException(message);
      }
    }

    const { source, target } = canonicalizeEndpoints(kind, { type: input.sourceType, id: input.sourceId }, { type: input.targetType, id: input.targetId });
    const duplicate = await tx.entityLink.findFirst({
      where: {
        workspaceId,
        kind,
        ...(definition.symmetric
          ? {
              OR: [
                { sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id },
                { sourceType: target.type, sourceId: target.id, targetType: source.type, targetId: source.id }
              ]
            }
          : { sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id })
      }
    });
    if (duplicate) throw new BadRequestException("Такая связь уже существует");

    const row = await tx.entityLink.create({
      data: {
        workspaceId,
        sourceType: source.type,
        sourceId: source.id,
        targetType: target.type,
        targetId: target.id,
        kind,
        label: input.label ?? null,
        bidirectional: definition.symmetric,
        createdById: userId
      }
    });

    await this.bus.publishTx(tx, {
      workspaceId,
      type: "entity_link.created",
      actorId: userId,
      payload: {
        type: kind,
        from: { type: row.sourceType as SearchableEntityType, id: row.sourceId },
        to: { type: row.targetType as SearchableEntityType, id: row.targetId }
      }
    });

    return this.toDto(row, targetTitle);
  }

  async remove(userId: string, workspaceId: string, linkId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.removeLinkTx(tx, userId, workspaceId, linkId);
    });
  }

  /** Body of `remove()`; the caller owns the transaction and the leading membership check. */
  async removeLinkTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, linkId: string): Promise<void> {
    const link = await tx.entityLink.findUnique({ where: { id: linkId } });
    if (!link || link.workspaceId !== workspaceId) throw new NotFoundException("Связь не найдена");
    const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
    this.assertTypeAccessible(accessible, link.sourceType as SearchableEntityType);
    this.assertTypeAccessible(accessible, link.targetType as SearchableEntityType);

    const result = await tx.entityLink.deleteMany({ where: { id: linkId, workspaceId } });
    if (!result.count) throw new NotFoundException("Связь не найдена");

    await this.bus.publishTx(tx, {
      workspaceId,
      type: "entity_link.deleted",
      actorId: userId,
      payload: {
        type: link.kind as RelationKind,
        from: { type: link.sourceType as SearchableEntityType, id: link.sourceId },
        to: { type: link.targetType as SearchableEntityType, id: link.targetId }
      }
    });
  }

  /**
   * Cascade helper for a module deleting one of its entities: removes only links touching that
   * entity and leaves the other side untouched. Public SDK contract — a deleting module calls this
   * inside its own write transaction.
   */
  async removeForEntityTx(tx: Prisma.TransactionClient, workspaceId: string, type: SearchableEntityType, id: string, actorId: string | null = null): Promise<number> {
    const rows = await tx.entityLink.findMany({
      where: { workspaceId, OR: [{ sourceType: type, sourceId: id }, { targetType: type, targetId: id }] }
    });
    if (!rows.length) return 0;
    const result = await tx.entityLink.deleteMany({ where: { id: { in: rows.map((row) => row.id) }, workspaceId } });
    for (const row of rows) {
      await this.bus.publishTx(tx, {
        workspaceId,
        type: "entity_link.deleted",
        actorId: actorId ?? undefined,
        payload: {
          type: row.kind as RelationKind,
          from: { type: row.sourceType as SearchableEntityType, id: row.sourceId },
          to: { type: row.targetType as SearchableEntityType, id: row.targetId }
        }
      });
    }
    return result.count;
  }

  /** Both sides of a link go through the same module gate as their direct endpoints (403 for a member). */
  async accessibleTypesTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<Set<SearchableEntityType>> {
    const modules = await this.modules.accessibleSetTx(tx, userId, workspaceId);
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { pluginOverrides: true } });
    const overrides = workspace?.pluginOverrides ?? [];
    return new Set(
      (Object.entries(ENTITY_REGISTRY) as Array<[SearchableEntityType, (typeof ENTITY_REGISTRY)[SearchableEntityType]]>)
        .filter(([, adapter]) => modules.has(adapter.moduleId) && (!adapter.pluginId || isPluginEnabled(overrides, adapter.pluginId)))
        .map(([type]) => type)
    );
  }

  assertTypeAccessible(accessible: Set<SearchableEntityType>, type: SearchableEntityType): void {
    if (!accessible.has(type)) throw new ForbiddenException("Модуль недоступен");
  }

  /** Safe summary; null if missing or owned by another workspace. Never throws, never leaks a title. */
  private async entityTitle(tx: Prisma.TransactionClient, workspaceId: string, type: SearchableEntityType, id: string): Promise<string | null> {
    return ENTITY_REGISTRY[type].summary(tx, workspaceId, id);
  }

  private async entityTitleOrThrow(tx: Prisma.TransactionClient, workspaceId: string, type: SearchableEntityType, id: string): Promise<string> {
    const title = await this.entityTitle(tx, workspaceId, type, id);
    if (title === null) throw new NotFoundException("Связываемый объект не найден");
    return title;
  }

  private toDto(row: Prisma.EntityLinkGetPayload<object>, title: string): EntityLink {
    return {
      id: row.id,
      sourceType: row.sourceType as SearchableEntityType,
      sourceId: row.sourceId,
      targetType: row.targetType as SearchableEntityType,
      targetId: row.targetId,
      kind: row.kind as RelationKind,
      label: row.label,
      bidirectional: row.bidirectional,
      title,
      createdAt: row.createdAt.toISOString()
    };
  }
}
