import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  MODULE_CATALOG,
  SEARCH_TYPE_MODULE,
  type CreateAndLinkInput,
  type CreateAndLinkResult,
  type CreateEntityLinkInput,
  type EntityLink,
  type EntityLinkPage,
  type GlobalSearchHit,
  type GlobalSearchQuery,
  type GlobalSearchResponse,
  type GlobalSearchResult,
  type SearchableEntityType
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { EntityLinksService } from "../entity-links/entity-links.service";
import { NoteOperations } from "../notes/public/note-operations";
import { TaskOperations } from "../tasks/public/task-operations";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { SEARCH_PROVIDER_LIMIT } from "./search-provider";
import { SearchProviderRegistry } from "./search-provider.registry";

/** `listLinks()` pagination knobs — same cursor shape as `TaskCommentPageOptions` (S17)/`TimePageOptions` (S15). */
export interface EntityLinkPageOptions {
  cursor?: string;
  limit?: number;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly entityLinks: EntityLinksService,
    private readonly tasks: TaskOperations,
    private readonly notes: NoteOperations,
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
      const accessible = await this.entityLinks.accessibleTypesTx(tx, userId, workspaceId);
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
   * Задание 10.2: единый вход `GET /search?workspaceId=&q=&types=&from=&to=&limit=`.
   * Отличие от `search()` выше — фильтры (типы и окно `updatedAt`), общий лимит
   * выдачи и метка модуля-источника с адресом записи. Права по-прежнему решает
   * провайдер вместе с ядром (`accessibleTypesTx`): инфраструктура не подменяет
   * права и не опрашивает провайдера выключенного модуля.
   */
  async globalSearch(userId: string, query: GlobalSearchQuery): Promise<GlobalSearchResponse> {
    const term = query.q.trim();
    const workspaceId = query.workspaceId;
    if (term.length < 2) {
      // Короткий запрос тоже проверяет членство, иначе посторонний получил бы 200 вместо 403.
      await this.workspaces.assertMember(userId, workspaceId);
      return { query: term, workspaceId, results: [] };
    }
    const from = boundDate(query.from, "from");
    const to = boundDate(query.to, "to", true);
    const limit = query.limit ?? 20;
    const results = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.entityLinks.accessibleTypesTx(tx, userId, workspaceId);
      const allowed = query.types ? new Set<SearchableEntityType>(query.types) : null;
      const canSearch = (type: SearchableEntityType): boolean => accessible.has(type) && (!allowed || allowed.has(type));
      const providers = this.providers.list().filter((provider) => canSearch(provider.entityType));
      const batches = await Promise.all(providers.map((provider) => provider.search(tx, workspaceId, term, SEARCH_PROVIDER_LIMIT)));
      const lower = term.toLocaleLowerCase("ru");
      return batches
        .flat()
        .filter((result) => withinWindow(result.updatedAt, from, to))
        .sort((a, b) => rank(b, lower) - rank(a, lower) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
        .map((result) => toHit(result, workspaceId));
    });
    return { query: term, workspaceId, results };
  }

  /**
   * Generic links are owned by the core entity-links layer (task 01). These methods remain for
   * the existing /links HTTP surface and for create-and-link; they contain no storage logic.
   */
  async listLinks(userId: string, workspaceId: string, type: SearchableEntityType, id: string, page: EntityLinkPageOptions = {}): Promise<EntityLinkPage> {
    return this.entityLinks.list(userId, workspaceId, type, id, page);
  }

  async createLink(userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink> {
    return this.entityLinks.create(userId, workspaceId, input);
  }

  /**
   * The body of `createLink()`, minus the `withUser` wrap — pulled out so
   * `createAndLink` (U03 Часть 1) can create the new entity AND this link
   * inside one transaction. Caller owns the transaction and the leading
   * `assertMemberTx`.
   */
  async createLinkTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink> {
    return this.entityLinks.createLinkTx(tx, userId, workspaceId, input);
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
   */
  async createAndLink(userId: string, workspaceId: string, input: CreateAndLinkInput): Promise<CreateAndLinkResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.entityLinks.accessibleTypesTx(tx, userId, workspaceId);
      this.entityLinks.assertTypeAccessible(accessible, input.entity.type);
      this.entityLinks.assertTypeAccessible(accessible, input.targetType);

      const created =
        input.entity.type === "task"
          ? await this.tasks.createTx(tx, userId, workspaceId, input.entity.input)
          : await this.notes.createTx(tx, userId, workspaceId, input.entity.input);

      const link = await this.entityLinks.createLinkTx(tx, userId, workspaceId, {
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

  async removeLink(userId: string, workspaceId: string, linkId: string): Promise<void> {
    return this.entityLinks.remove(userId, workspaceId, linkId);
  }
}

function rank(item: GlobalSearchResult, lower: string): number {
  const title = item.title.toLocaleLowerCase("ru");
  return title === lower ? 100 : title.startsWith(lower) ? 50 : title.includes(lower) ? 25 : 0;
}

/** Граница окна `from`/`to`; дата без времени для `to` включает весь день. */
function boundDate(value: string | undefined, name: "from" | "to", endOfDay = false): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`Некорректная дата «${value}» в параметре ${name}`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function withinWindow(updatedAtIso: string, from: Date | null, to: Date | null): boolean {
  const time = Date.parse(updatedAtIso);
  if (Number.isNaN(time)) return false;
  if (from && time < from.getTime()) return false;
  if (to && time > to.getTime()) return false;
  return true;
}

function toHit(result: GlobalSearchResult, workspaceId: string): GlobalSearchHit {
  const module = SEARCH_TYPE_MODULE[result.type];
  return {
    ...result,
    module,
    moduleLabel: MODULE_CATALOG.find((item) => item.id === module)?.label ?? module,
    deepLink: { workspaceId, entityType: result.type, entityId: result.id }
  };
}
