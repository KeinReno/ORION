import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  CreateAndLinkInput,
  CreateAndLinkResult,
  CreateEntityLinkInput,
  EntityLink,
  EntityLinkPage,
  GlobalSearchResult,
  RelationKind,
  SearchableEntityType
} from "@orion/shared-types";
import { canonicalizeEndpoints, isPluginEnabled, isRelationPairAllowed } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { NotesService } from "../notes/notes.service";
import { TasksService } from "../tasks/tasks.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ENTITY_REGISTRY } from "./entity-registry";
import { SEARCH_PROVIDER_LIMIT } from "./search-provider";
import { SearchProviderRegistry } from "./search-provider.registry";

/** `listLinks()` pagination knobs — same cursor shape as `TaskCommentPageOptions` (S17)/`TimePageOptions` (S15). */
export interface EntityLinkPageOptions {
  cursor?: string;
  limit?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TasksService,
    private readonly notes: NotesService,
    private readonly providers: SearchProviderRegistry
  ) {}

  /**
   * `allowedTypes` narrows the search to those entity types on top of the module gate — the Agent Gateway passes
   * the types its token has read scopes for, so a token never even queries the rest.
   */
  async search(userId: string, workspaceId: string, query: string, allowedTypes?: readonly SearchableEntityType[]): Promise<GlobalSearchResult[]> {
    const term = query.trim();
    if (term.length < 2) {
      // ТЗ-05: короткий запрос тоже сперва проверяет членство — иначе посторонний получал 200 вместо 403.
      await this.workspaces.assertMember(userId, workspaceId);
      return [];
    }
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
      // Check both the module and the exact type: one module can expose several types
      // (projects + goals, finance + accounts). Agent token scopes must not bleed between them.
      const canSearch = (type: SearchableEntityType): boolean => accessible.has(type) && (!allowedTypes || allowedTypes.includes(type));
      // Каждый провайдер ищет в своём домене; выключенный модуль/плагин не опрашивается вовсе.
      const providers = this.providers.list().filter((provider) => canSearch(provider.entityType));
      const batches = await Promise.all(providers.map((provider) => provider.search(tx, workspaceId, term, SEARCH_PROVIDER_LIMIT)));
      const results: GlobalSearchResult[] = batches.flat();
      const lower = term.toLocaleLowerCase("ru");
      return results
        .sort((a, b) => rank(b, lower) - rank(a, lower) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 30);
    });
  }

  /**
   * Cursor-paginated (newest first). A row whose *other* endpoint's module is
   * currently restricted/disabled for this actor is silently skipped, not
   * counted and not exposed — same rule `listLinks` had before pagination
   * (23-UNIVERSAL-CONNECTED-CORE.md: "скрытые записи не увеличивают счётчик и
   * не раскрываются"). That means a page can come back shorter than `limit`
   * even when `nextCursor` is non-null; the client should keep requesting
   * `nextCursor` until it is `null`, not stop on a short page.
   */
  async listLinks(userId: string, workspaceId: string, type: SearchableEntityType, id: string, page: EntityLinkPageOptions = {}): Promise<EntityLinkPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
      this.assertTypeAccessible(accessible, type);
      await this.entityTitleOrThrow(tx, workspaceId, type, id);

      const where: Prisma.EntityLinkWhereInput = { workspaceId, OR: [{ sourceType: type, sourceId: id }, { targetType: type, targetId: id }] };
      if (page.cursor) {
        const cursorRow = await tx.entityLink.findUnique({ where: { id: page.cursor }, select: { id: true, workspaceId: true, createdAt: true } });
        if (!cursorRow || cursorRow.workspaceId !== workspaceId) {
          throw new BadRequestException("Курсор пагинации недействителен");
        }
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
        // The other side's module may be restricted/disabled for this actor —
        // skip the link entirely rather than calling `entityTitle` on it
        // (which would leak the title even if the caller ignored it).
        if (!accessible.has(otherType)) continue;
        const title = await this.entityTitle(tx, workspaceId, otherType, otherId);
        if (title === null) continue;
        links.push({
          id: row.id,
          sourceType: row.sourceType as SearchableEntityType,
          sourceId: row.sourceId,
          targetType: row.targetType as SearchableEntityType,
          targetId: row.targetId,
          kind: row.kind as RelationKind,
          label: row.label,
          title,
          createdAt: row.createdAt.toISOString()
        });
      }
      return { items: links, nextCursor: hasMore ? pageRows[pageRows.length - 1]!.id : null };
    });
  }

  async createLink(userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.createLinkTx(tx, userId, workspaceId, input);
    });
  }

  /**
   * The body of `createLink()`, minus the `withUser` wrap — pulled out so
   * `createAndLink` (U03 Часть 1) can create the new entity AND this link
   * inside one transaction. Caller owns the transaction and the leading
   * `assertMemberTx`.
   */
  async createLinkTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink> {
    const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
    this.assertTypeAccessible(accessible, input.sourceType);
    this.assertTypeAccessible(accessible, input.targetType);

    // Defense in depth: the zod input schema already rejects this shape at
    // the controller boundary, but the service is also called directly by
    // tests and must not rely solely on that outer layer.
    if (input.sourceType === input.targetType && input.sourceId === input.targetId) {
      throw new BadRequestException("Нельзя связать объект с самим собой");
    }

    const kind: RelationKind = input.kind ?? "related_to";
    if (!isRelationPairAllowed(kind, input.sourceType, input.targetType)) {
      throw new BadRequestException("Недопустимая пара типов для этого вида связи");
    }

    // Both endpoints must exist and belong to this workspace — read before
    // any normalization so the 404 always reflects what the caller sent.
    await this.entityTitleOrThrow(tx, workspaceId, input.sourceType, input.sourceId);
    const targetTitleRaw = await this.entityTitleOrThrow(tx, workspaceId, input.targetType, input.targetId);

    if (kind === "goal_prerequisite") {
      // Serialize dependency edits in this workspace. Otherwise two concurrent
      // requests could each see an acyclic graph and commit a cycle together.
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      const edges = await tx.entityLink.findMany({
        where: { workspaceId, kind },
        select: { sourceId: true, targetId: true }
      });
      // source must finish before target. A path target -> source would close a cycle.
      const outgoing = new Map<string, string[]>();
      for (const edge of edges) outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge.targetId]);
      const pending = [input.targetId];
      const visited = new Set<string>();
      while (pending.length) {
        const current = pending.pop()!;
        if (current === input.sourceId) throw new BadRequestException("Зависимость создаёт замкнутый круг целей");
        if (visited.has(current)) continue;
        visited.add(current);
        pending.push(...(outgoing.get(current) ?? []));
      }
    }

    // Symmetric kinds (related_to) canonicalize endpoint order so A->B and
    // B->A are always the same stored row, not two mirrored ones. Both
    // endpoints were already confirmed to exist above, so no re-fetch is
    // needed here regardless of which side ends up as `source`.
    const { source, target } = canonicalizeEndpoints(kind, { type: input.sourceType, id: input.sourceId }, { type: input.targetType, id: input.targetId });

    const existing = await tx.entityLink.findFirst({
      where: {
        workspaceId,
        kind,
        OR: [
          { sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id },
          { sourceType: target.type, sourceId: target.id, targetType: source.type, targetId: source.id }
        ]
      }
    });
    if (existing) throw new BadRequestException("Такая связь уже существует");

    const row = await tx.entityLink.create({
      data: {
        workspaceId,
        sourceType: source.type,
        sourceId: source.id,
        targetType: target.type,
        targetId: target.id,
        kind,
        label: input.label ?? null
      }
    });
    return {
      id: row.id,
      sourceType: row.sourceType as SearchableEntityType,
      sourceId: row.sourceId,
      targetType: row.targetType as SearchableEntityType,
      targetId: row.targetId,
      kind: row.kind as RelationKind,
      label: row.label,
      // Always describe the caller's own requested target, regardless of
      // which side ended up stored as `source`/`target` after canonicalization.
      title: targetTitleRaw,
      createdAt: row.createdAt.toISOString()
    };
  }

  /**
   * U03 Часть 1 (24-CONNECTED-CORE-BACKLOG.md): create a new task/note AND
   * link it to `target`, atomically — a single Postgres transaction, not two
   * sequential HTTP round-trips. If anything fails (validation, a rejected
   * `kind`/pair, the target not existing) the whole transaction rolls back:
   * neither the new entity nor the link is left half-created.
   *
   * `document` is deliberately not handled here — see the doc comment on
   * `createAndLinkInputSchema`.
   *
   * Idempotency: `input.idempotencyKey` is accepted (for the client's own
   * bookkeeping / future use) but NOT deduplicated server-side. This method
   * gives no stronger guarantee against a literal double-submit than
   * `createLink`/`create` did individually — see the shared-types doc
   * comment for the accepted gap.
   */
  async createAndLink(userId: string, workspaceId: string, input: CreateAndLinkInput): Promise<CreateAndLinkResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
      this.assertTypeAccessible(accessible, input.entity.type);
      this.assertTypeAccessible(accessible, input.targetType);

      const created =
        input.entity.type === "task"
          ? await this.tasks.createTx(tx, userId, workspaceId, input.entity.input)
          : await this.notes.createTx(tx, userId, workspaceId, input.entity.input);

      const link = await this.createLinkTx(tx, userId, workspaceId, {
        sourceType: input.entity.type,
        sourceId: created.id,
        targetType: input.targetType,
        targetId: input.targetId,
        kind: input.kind ?? "related_to",
        label: null
      });

      return { entityType: input.entity.type, entityId: created.id, link };
    });
  }

  /** Both sides of a link go through the same module gate as their direct endpoints (403 for a `member`). */
  private async accessibleTypesTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<Set<SearchableEntityType>> {
    const modules = await this.modules.accessibleSetTx(tx, userId, workspaceId);
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { pluginOverrides: true } });
    const overrides = workspace?.pluginOverrides ?? [];
    return new Set(
      (Object.entries(ENTITY_REGISTRY) as Array<[SearchableEntityType, (typeof ENTITY_REGISTRY)[SearchableEntityType]]>)
        .filter(([, adapter]) => modules.has(adapter.moduleId) && (!adapter.pluginId || isPluginEnabled(overrides, adapter.pluginId)))
        .map(([type]) => type)
    );
  }

  private assertTypeAccessible(accessible: Set<SearchableEntityType>, type: SearchableEntityType): void {
    if (!accessible.has(type)) {
      throw new ForbiddenException("Модуль недоступен");
    }
  }

  /**
   * R28-03: `create`/`list` both gate every endpoint through
   * `accessibleSetTx`, but `removeLink` used to be `assertMemberTx` +
   * `deleteMany({id, workspaceId})` only — no module check at all. A member
   * who learned a link's id before its `tasks`/`notes` endpoint was
   * restricted could still delete that link afterwards, even though they can
   * no longer see (or create) links for either side. Both endpoints are now
   * checked against the SAME accessible set `create`/`list` use, in the same
   * transaction as the delete, so the check and the write can't race a
   * concurrent restriction change.
   */
  async removeLink(userId: string, workspaceId: string, linkId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const link = await tx.entityLink.findUnique({ where: { id: linkId } });
      if (!link || link.workspaceId !== workspaceId) {
        throw new NotFoundException("Связь не найдена");
      }
      const accessible = await this.accessibleTypesTx(tx, userId, workspaceId);
      this.assertTypeAccessible(accessible, link.sourceType as SearchableEntityType);
      this.assertTypeAccessible(accessible, link.targetType as SearchableEntityType);

      const result = await tx.entityLink.deleteMany({ where: { id: linkId, workspaceId } });
      if (!result.count) throw new NotFoundException("Связь не найдена");
    });
  }

  /** Safe summary via the closed entity-type registry; `null` if the row is missing or not owned by `workspaceId`. Never throws, never leaks a foreign title. */
  private async entityTitle(tx: Prisma.TransactionClient, workspaceId: string, type: SearchableEntityType, id: string): Promise<string | null> {
    return ENTITY_REGISTRY[type].summary(tx, workspaceId, id);
  }

  private async entityTitleOrThrow(tx: Prisma.TransactionClient, workspaceId: string, type: SearchableEntityType, id: string): Promise<string> {
    const title = await this.entityTitle(tx, workspaceId, type, id);
    if (title === null) throw new NotFoundException("Связываемый объект не найден");
    return title;
  }
}

function rank(item: GlobalSearchResult, lower: string): number {
  const title = item.title.toLocaleLowerCase("ru");
  return title === lower ? 100 : title.startsWith(lower) ? 50 : title.includes(lower) ? 25 : 0;
}
