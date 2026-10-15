import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { acceptFinanceDraftInputSchema, type AcceptFinanceDraftInput, type FinanceDraft, type Transaction } from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequirePlugin } from "../../plugins/require-plugin";
import { FinanceDraftsService } from "./finance-drafts.service";

/** The human side: look at the drafts agents proposed, correct and confirm one, or reject it. */
@RequireModule("finance")
@RequirePlugin("finance-ai-drafts")
@Controller("workspaces/:workspaceId/finance/drafts")
export class FinanceDraftsController {
  constructor(private readonly drafts: FinanceDraftsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<FinanceDraft[]> {
    return this.drafts.list(user.userId, workspaceId);
  }

  @Post(":draftId/accept")
  @HttpCode(201)
  accept(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("draftId") draftId: string,
    @Body(new ZodValidationPipe(acceptFinanceDraftInputSchema)) body: AcceptFinanceDraftInput
  ): Promise<{ draft: FinanceDraft; transaction: Transaction }> {
    return this.drafts.accept(user.userId, workspaceId, draftId, body);
  }

  @Post(":draftId/reject")
  @HttpCode(200)
  reject(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("draftId") draftId: string): Promise<FinanceDraft> {
    return this.drafts.reject(user.userId, workspaceId, draftId);
  }
}
