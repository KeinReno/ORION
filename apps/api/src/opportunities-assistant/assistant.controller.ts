import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  createAssessmentInputSchema, createDraftInputSchema, rejectDraftInputSchema, reviewDraftInputSchema, updateDraftInputSchema,
  type CreateAssessmentInput, type CreateDraftInput, type RejectDraftInput, type ReviewDraftInput, type UpdateDraftInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequirePlugin } from "../plugins/require-plugin";
import { AssistantService } from "./assistant.service";

const assessmentQuery = z.object({ opportunityId: z.string().uuid().optional(), profileId: z.string().uuid().optional(), cursor: z.string().uuid().optional() }).strict();
const draftQuery = z.object({ opportunityId: z.string().uuid().optional(), cursor: z.string().uuid().optional() }).strict();

/** Route order: static segments (`status`, `assessments`, `drafts`) never collide with `:id` — each group has its own prefix. */
@RequirePlugin("opportunities-assistant")
@Controller("workspaces/:workspaceId/opportunity-assistant")
export class AssistantController {
  constructor(private readonly service: AssistantService) {}
  @Get("status") status() { return this.service.status(); }
  @Post("assessments") assess(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(createAssessmentInputSchema)) b: CreateAssessmentInput) { return this.service.assess(u.userId, ws, b); }
  @Get("assessments") assessments(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Query(new ZodValidationPipe(assessmentQuery)) q: z.infer<typeof assessmentQuery>) { return this.service.listAssessments(u.userId, ws, q); }
  @Get("assessments/:id") assessment(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.getAssessment(u.userId, ws, id); }
  @Post("drafts") createDraft(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(createDraftInputSchema)) b: CreateDraftInput) { return this.service.createDraft(u.userId, ws, b); }
  @Get("drafts") drafts(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Query(new ZodValidationPipe(draftQuery)) q: z.infer<typeof draftQuery>) { return this.service.listDrafts(u.userId, ws, q); }
  @Get("drafts/:id") draft(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.getDraft(u.userId, ws, id); }
  @Patch("drafts/:id") update(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateDraftInputSchema)) b: UpdateDraftInput) { return this.service.updateDraft(u.userId, ws, id, b); }
  @Post("drafts/:id/approve") approve(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reviewDraftInputSchema)) b: ReviewDraftInput) { return this.service.approve(u.userId, ws, id, b); }
  @Post("drafts/:id/reject") reject(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rejectDraftInputSchema)) b: RejectDraftInput) { return this.service.reject(u.userId, ws, id, b); }
  @Post("drafts/:id/dry-run") dryRun(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.dryRun(u.userId, ws, id); }
}
