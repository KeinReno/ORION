import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  createAndLinkInputSchema,
  createEntityLinkInputSchema,
  searchableEntityTypeSchema,
  type CreateAndLinkInput,
  type CreateAndLinkResult,
  type CreateEntityLinkInput,
  type EntityLink,
  type EntityLinkPage,
  type GlobalSearchResult
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SearchService } from "./search.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get("search")
  search(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("q") query = ""): Promise<GlobalSearchResult[]> {
    return this.searchService.search(user.userId, workspaceId, query);
  }

  @Get("links")
  links(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("type") type: string,
    @Query("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ): Promise<EntityLinkPage> {
    return this.searchService.listLinks(user.userId, workspaceId, searchableEntityTypeSchema.parse(type), id, {
      cursor: cursor || undefined,
      limit: limit ? Number(limit) : undefined
    });
  }

  @Post("links")
  createLink(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Body(new ZodValidationPipe(createEntityLinkInputSchema)) body: CreateEntityLinkInput): Promise<EntityLink> {
    return this.searchService.createLink(user.userId, workspaceId, body);
  }

  @Post("create-and-link")
  createAndLink(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createAndLinkInputSchema)) body: CreateAndLinkInput
  ): Promise<CreateAndLinkResult> {
    return this.searchService.createAndLink(user.userId, workspaceId, body);
  }

  @Delete("links/:linkId")
  @HttpCode(204)
  removeLink(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("linkId") linkId: string): Promise<void> {
    return this.searchService.removeLink(user.userId, workspaceId, linkId);
  }
}
