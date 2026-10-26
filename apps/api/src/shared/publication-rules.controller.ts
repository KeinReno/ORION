import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { publicationRuleConfigSchema, publicationRuleEditSchema, publicationRuleEnableSchema, publicationRuleRevisionSchema, type PublicationRuleConfig, type PublicationRuleEnable } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { PublicationRulesService } from "./publication-rules.service";

@UseGuards(JwtAuthGuard)
@Controller("publication-rules")
export class PublicationRulesController {
  constructor(private readonly rules: PublicationRulesService) {}
  @Post() create(@CurrentUser() u: RequestUser, @Body(new ZodValidationPipe(publicationRuleConfigSchema)) config: PublicationRuleConfig) { return this.rules.create(u.userId, config); }
  @Get() list(@CurrentUser() u: RequestUser) { return this.rules.list(u.userId); }
  @Get(":id") get(@CurrentUser() u: RequestUser, @Param("id") id: string) { return this.rules.get(u.userId, id); }
  @Get(":id/preview") preview(@CurrentUser() u: RequestUser, @Param("id") id: string) { return this.rules.preview(u.userId, id); }
  @Patch(":id") edit(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationRuleEditSchema)) input: { expectedRevision: number; config: PublicationRuleConfig }) { return this.rules.edit(u.userId, id, input.expectedRevision, input.config); }
  @Post(":id/enable") enable(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationRuleEnableSchema)) input: PublicationRuleEnable) { return this.rules.enable(u.userId, id, input); }
  @Post(":id/pause") pause(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationRuleRevisionSchema)) input: { expectedRevision: number }) { return this.rules.pause(u.userId, id, input.expectedRevision); }
  @Post(":id/run") run(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationRuleRevisionSchema)) input: { expectedRevision: number }) { return this.rules.run(u.userId, id, input.expectedRevision); }
  @Delete(":id") remove(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationRuleRevisionSchema)) input: { expectedRevision: number }) { return this.rules.remove(u.userId, id, input.expectedRevision); }
}
