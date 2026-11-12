import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  createEntityLinkInputSchema,
  searchableEntityTypeSchema,
  type CreateEntityLinkInput,
  type EntityLink,
  type EntityLinkPage
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { EntityLinksService } from "./entity-links.service";

/** Canonical HTTP surface of the core connection layer (task 01.1). */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/entity-links")
export class EntityLinksController {
  constructor(private readonly links: EntityLinksService) {}

  @Get()
  @RequirePermission("entity-links.link.read")
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("type") type: string,
    @Query("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ): Promise<EntityLinkPage> {
    const entityType = searchableEntityTypeSchema.safeParse(type);
    if (!entityType.success) throw new BadRequestException("Неизвестный тип объекта");
    return this.links.list(user.userId, workspaceId, entityType.data, id ?? "", {
      cursor: cursor || undefined,
      limit: limit ? Number(limit) : undefined
    });
  }

  @Post()
  @RequirePermission("entity-links.link.manage")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createEntityLinkInputSchema)) body: CreateEntityLinkInput
  ): Promise<EntityLink> {
    return this.links.create(user.userId, workspaceId, body);
  }

  @Delete(":linkId")
  @HttpCode(204)
  @RequirePermission("entity-links.link.manage")
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("linkId") linkId: string): Promise<void> {
    return this.links.remove(user.userId, workspaceId, linkId);
  }
}
