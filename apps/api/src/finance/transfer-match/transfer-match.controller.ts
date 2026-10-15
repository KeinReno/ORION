import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { mergeTransferInputSchema, type MergeTransferInput, type Transaction } from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequirePlugin } from "../../plugins/require-plugin";
import { TransferMatchService } from "./transfer-match.service";

@RequireModule("finance")
@RequirePlugin("finance-transfer-match")
@Controller("workspaces/:workspaceId/finance/transfer-match")
export class TransferMatchController {
  constructor(private readonly match: TransferMatchService) {}

  /** Replaces an expense + an income that are one transfer with a single transfer. */
  @Post("merge")
  @HttpCode(201)
  merge(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(mergeTransferInputSchema)) body: MergeTransferInput
  ): Promise<Transaction> {
    return this.match.merge(user.userId, workspaceId, body);
  }
}
