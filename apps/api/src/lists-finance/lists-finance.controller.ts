import { Body, Controller, Param, Post } from "@nestjs/common";
import { recordListExpenseInputSchema, type RecordListExpenseInput, type RecordListExpenseResult } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { RequirePlugin } from "../plugins/require-plugin";
import { ListsFinanceService } from "./lists-finance.service";

/** Server side of the «Покупки → Финансы» plugin: 409 with Lists or the plugin off; the service also requires Finance. */
@RequireModule("lists")
@RequirePlugin("lists-finance")
@Controller("workspaces/:workspaceId/lists-finance")
export class ListsFinanceController {
  constructor(private readonly bridge: ListsFinanceService) {}

  @Post("lists/:listId/expense")
  recordExpense(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(recordListExpenseInputSchema)) body: RecordListExpenseInput
  ): Promise<RecordListExpenseResult> {
    return this.bridge.recordExpense(user.userId, workspaceId, listId, body);
  }
}
