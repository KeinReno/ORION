import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { createOpportunityInputSchema, opportunityListQuerySchema, updateOpportunityInputSchema, type CreateOpportunityInput, type OpportunityListQuery, type UpdateOpportunityInput } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { OpportunitiesService } from "./opportunities.service";
import { z } from "zod";
const revisionInput = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();

@RequireModule("opportunities")
@Controller("workspaces/:workspaceId/opportunities")
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}
  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Query(new ZodValidationPipe(opportunityListQuerySchema)) query: OpportunityListQuery) { return this.service.list(user.userId, ws, query); }
  @Get("export")
  export(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string) { return this.service.export(user.userId, ws); }
  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("id") id: string) { return this.service.get(user.userId, ws, id); }
  @Post()
  create(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(createOpportunityInputSchema)) body: CreateOpportunityInput) { return this.service.create(user.userId, ws, body); }
  @Patch(":id")
  update(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("id") id: string, @Body(new ZodValidationPipe(updateOpportunityInputSchema)) body: UpdateOpportunityInput) { return this.service.update(user.userId, ws, id, body); }
  @Post(":id/archive")
  archive(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("id") id: string, @Body(new ZodValidationPipe(revisionInput)) body: { expectedRevision: number }) { return this.service.update(user.userId, ws, id, { ...body, archivedAt: new Date().toISOString() }); }
  @Post(":id/restore")
  restore(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("id") id: string, @Body(new ZodValidationPipe(revisionInput)) body: { expectedRevision: number }) { return this.service.update(user.userId, ws, id, { ...body, archivedAt: null }); }
}
