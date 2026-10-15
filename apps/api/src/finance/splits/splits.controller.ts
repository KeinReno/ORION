import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  createSettlementInputSchema,
  createSplitInputSchema,
  type CreateSettlementInput,
  type CreateSplitInput,
  type Settlement,
  type Split,
  type SplitOverview
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequirePlugin } from "../../plugins/require-plugin";
import { SplitsService } from "./splits.service";

@RequireModule("finance")
@RequirePlugin("finance-split")
@Controller("workspaces/:workspaceId/finance/splits")
export class SplitsController {
  constructor(private readonly splits: SplitsService) {}

  @Get()
  overview(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<SplitOverview> {
    return this.splits.overview(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createSplitInputSchema)) body: CreateSplitInput
  ): Promise<Split> {
    return this.splits.createSplit(user.userId, workspaceId, body);
  }

  // Declared before `:splitId` so «settlements» is never read as an id.
  @Post("settlements")
  @HttpCode(201)
  createSettlement(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createSettlementInputSchema)) body: CreateSettlementInput
  ): Promise<Settlement> {
    return this.splits.createSettlement(user.userId, workspaceId, body);
  }

  @Delete("settlements/:settlementId")
  removeSettlement(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("settlementId") settlementId: string): Promise<void> {
    return this.splits.removeSettlement(user.userId, workspaceId, settlementId);
  }

  @Delete(":splitId")
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("splitId") splitId: string): Promise<void> {
    return this.splits.removeSplit(user.userId, workspaceId, splitId);
  }
}
