import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  globalSearchQuerySchema,
  searchableEntityTypeSchema,
  type GlobalSearchResponse,
  type SearchableEntityType
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { SearchService } from "./search.service";

/**
 * Единый вход глобального поиска (задание 10.2): `GET /search?workspaceId=&q=`.
 *
 * Существующий workspace-маршрут `GET /workspaces/:id/search` остаётся для
 * старых клиентов и не меняется; этот контроллер — стабильный контракт с
 * фильтрами по типам и окну `updatedAt`, общим лимитом и меткой модуля-источника.
 */
@UseGuards(JwtAuthGuard)
@Controller("search")
export class GlobalSearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @CurrentUser() user: RequestUser,
    @Query("workspaceId") workspaceId = "",
    @Query("q") q = "",
    @Query("types") types?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string
  ): Promise<GlobalSearchResponse> {
    const parsedTypes = parseTypes(types);
    const parsedLimit = limit === undefined || limit === "" ? undefined : Number(limit);
    if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) throw new BadRequestException("limit должен быть целым числом");
    const parsed = globalSearchQuerySchema.safeParse({
      workspaceId,
      q,
      ...(parsedTypes ? { types: parsedTypes } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {})
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.searchService.globalSearch(user.userId, parsed.data);
  }
}

/** `types=task,note` → проверенный список типов; неизвестный тип — 400, а не тихо пустая выдача. */
function parseTypes(value: string | undefined): SearchableEntityType[] | undefined {
  if (!value?.trim()) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.map((part) => {
    const parsed = searchableEntityTypeSchema.safeParse(part);
    if (!parsed.success) throw new BadRequestException(`Неизвестный тип объекта: «${part}»`);
    return parsed.data;
  });
}
