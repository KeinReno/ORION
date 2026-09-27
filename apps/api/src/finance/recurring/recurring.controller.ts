import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createRecurringTransactionInputSchema,
  updateRecurringTransactionInputSchema,
  type CreateRecurringTransactionInput,
  type RecurringTransaction,
  type UpdateRecurringTransactionInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RecurringService } from "./recurring.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/recurring")
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<RecurringTransaction[]> {
    return this.recurring.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createRecurringTransactionInputSchema)) body: CreateRecurringTransactionInput
  ): Promise<RecurringTransaction> {
    return this.recurring.create(user.userId, workspaceId, body);
  }

  @Patch(":recurringId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("recurringId") recurringId: string,
    @Body(new ZodValidationPipe(updateRecurringTransactionInputSchema)) body: UpdateRecurringTransactionInput
  ): Promise<RecurringTransaction> {
    return this.recurring.update(user.userId, workspaceId, recurringId, body);
  }

  @Delete(":recurringId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("recurringId") recurringId: string
  ): Promise<void> {
    return this.recurring.remove(user.userId, workspaceId, recurringId);
  }
}
