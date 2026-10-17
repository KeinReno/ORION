import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { createOpportunityProfileInputSchema, updateOpportunityProfileInputSchema, createOpportunityFactInputSchema, setOpportunityFactStateInputSchema, createOpportunityTrackInputSchema, createOpportunityMaterialInputSchema, type CreateOpportunityProfileInput, type UpdateOpportunityProfileInput, type CreateOpportunityFactInput, type SetOpportunityFactStateInput, type CreateOpportunityTrackInput, type CreateOpportunityMaterialInput } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequirePlugin } from "../plugins/require-plugin";
import { ProfilesService } from "./profiles.service";
import { selectOpportunityResumeInputSchema, type SelectOpportunityResumeInput, updateOpportunityFactInputSchema, type UpdateOpportunityFactInput, archiveOpportunityItemInputSchema, type ArchiveOpportunityItemInput, updateOpportunityTrackInputSchema, type UpdateOpportunityTrackInput } from "@orion/shared-types";
const page = z.object({ cursor: z.string().uuid().optional(), includeArchived: z.enum(["true", "false"]).optional() }).strict();
@RequirePlugin("opportunities-profiles")
@Controller("workspaces/:workspaceId/opportunity-profiles")
export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}
  @Post(":id/active-resume") selectResume(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(selectOpportunityResumeInputSchema)) b: SelectOpportunityResumeInput) { return this.service.selectResume(u.userId, ws, id, b); }
  @Get() list(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Query(new ZodValidationPipe(page)) q: z.infer<typeof page>) { return this.service.list(u.userId, ws, q.cursor, q.includeArchived === "true"); }
  @Post() create(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(createOpportunityProfileInputSchema)) b: CreateOpportunityProfileInput) { return this.service.create(u.userId, ws, b); }
  @Get(":id") detail(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.detail(u.userId, ws, id); }
  @Patch(":id") update(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateOpportunityProfileInputSchema)) b: UpdateOpportunityProfileInput) { return this.service.update(u.userId, ws, id, b); }
  @Post(":id/facts") fact(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createOpportunityFactInputSchema)) b: CreateOpportunityFactInput) { return this.service.addFact(u.userId, ws, id, b); }
  @Patch(":id/facts/:factId") state(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Param("factId", ParseUUIDPipe) fact: string, @Body(new ZodValidationPipe(setOpportunityFactStateInputSchema)) b: SetOpportunityFactStateInput) { return this.service.factState(u.userId, ws, id, fact, b); }
  @Patch(":id/facts/:factId/content") factContent(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Param("factId", ParseUUIDPipe) fact: string, @Body(new ZodValidationPipe(updateOpportunityFactInputSchema)) b: UpdateOpportunityFactInput) { return this.service.updateFact(u.userId, ws, id, fact, b); }
  @Post(":id/facts/:factId/archive") factArchive(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Param("factId", ParseUUIDPipe) fact: string, @Body(new ZodValidationPipe(archiveOpportunityItemInputSchema)) b: ArchiveOpportunityItemInput) { return this.service.archiveFact(u.userId, ws, id, fact, b); }
  @Patch(":id/tracks/:trackId") trackUpdate(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Param("trackId", ParseUUIDPipe) track: string, @Body(new ZodValidationPipe(updateOpportunityTrackInputSchema)) b: UpdateOpportunityTrackInput) { return this.service.updateTrack(u.userId, ws, id, track, b); }
  @Post(":id/tracks/:trackId/archive") trackArchive(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Param("trackId", ParseUUIDPipe) track: string, @Body(new ZodValidationPipe(archiveOpportunityItemInputSchema)) b: ArchiveOpportunityItemInput) { return this.service.archiveTrack(u.userId, ws, id, track, b); }
  @Post(":id/tracks") track(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createOpportunityTrackInputSchema)) b: CreateOpportunityTrackInput) { return this.service.addTrack(u.userId, ws, id, b); }
  @Post(":id/materials") addMaterial(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createOpportunityMaterialInputSchema)) b: CreateOpportunityMaterialInput) { return this.service.addMaterial(u.userId, ws, id, b); }
  @Get(":id/materials") materials(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(page)) q: z.infer<typeof page>) { return this.service.materials(u.userId, ws, id, q.cursor); }
  @Get(":id/materials/:materialId") material(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Param("materialId", ParseUUIDPipe) m: string) { return this.service.material(u.userId, ws, id, m); }
}
