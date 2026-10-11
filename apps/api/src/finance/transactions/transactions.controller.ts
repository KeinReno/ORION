import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createTransactionInputSchema,
  financeImportInputSchema,
  updateTransactionInputSchema,
  type CreateTransactionInput,
  type FinanceImportInput,
  type FinanceImportResult,
  type Transaction,
  type UpdateTransactionInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { RequirePlugin } from "../../plugins/require-plugin";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { TransactionsService } from "./transactions.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/transactions")
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("accountId") accountId?: string,
    @Query("categoryId") categoryId?: string,
    @Query("tag") tag?: string,
    @Query("month") month?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<Transaction[]> {
    return this.transactions.list(user.userId, workspaceId, {
      accountId,
      categoryId,
      tag,
      month,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    });
  }

  @Get(":transactionId")
  get(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("transactionId") transactionId: string
  ): Promise<Transaction> {
    return this.transactions.get(user.userId, workspaceId, transactionId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createTransactionInputSchema)) body: CreateTransactionInput
  ): Promise<Transaction> {
    return this.transactions.create(user.userId, workspaceId, body);
  }

  /** Registered before `:transactionId` routes so "import" is never read as an id. */
  @Post("import")
  @RequirePlugin("finance-import")
  importRows(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(financeImportInputSchema)) body: FinanceImportInput
  ): Promise<FinanceImportResult> {
    return this.transactions.importRows(user.userId, workspaceId, body);
  }

  @Patch(":transactionId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("transactionId") transactionId: string,
    @Body(new ZodValidationPipe(updateTransactionInputSchema)) body: UpdateTransactionInput
  ): Promise<Transaction> {
    return this.transactions.update(user.userId, workspaceId, transactionId, body);
  }

  @Delete(":transactionId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("transactionId") transactionId: string
  ): Promise<void> {
    return this.transactions.remove(user.userId, workspaceId, transactionId);
  }
}
