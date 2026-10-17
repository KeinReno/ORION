import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { hhImportPreviewInputSchema, hhImportApplyInputSchema, hhHistoryQuerySchema, type HhImportPreviewInput, type HhImportApplyInput, type HhHistoryQuery } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequirePlugin } from "../plugins/require-plugin";
import { HhImportService } from "./hh-import.service";
@RequirePlugin("opportunities-hh-import")
@Controller("workspaces/:workspaceId/opportunity-hh-import")
export class HhImportController {
  constructor(private readonly service: HhImportService) {}
  @Post("preview") preview(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(hhImportPreviewInputSchema)) b: HhImportPreviewInput) { return this.service.preview(u.userId, ws, b); }
  @Get() recent(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string) { return this.service.recent(u.userId, ws); }
  @Get("history") history(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Query(new ZodValidationPipe(hhHistoryQuerySchema)) q: HhHistoryQuery) { return this.service.history(u.userId, ws, q); }
  @Get("sources/:opportunityId") sources(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("opportunityId", ParseUUIDPipe) id: string) { return this.service.sources(u.userId, ws, id); }
  @Get(":id") get(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.get(u.userId, ws, id); }
  @Post(":id/apply") apply(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(hhImportApplyInputSchema)) b: HhImportApplyInput) { return this.service.change(u.userId, ws, id, b); }
  @Post(":id/cancel") cancel(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(hhImportApplyInputSchema)) b: HhImportApplyInput) { return this.service.change(u.userId, ws, id, b, true); }
}
