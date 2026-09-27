import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createAccountInputSchema,
  reconcileAccountInputSchema,
  updateAccountInputSchema,
  type Account,
  type CreateAccountInput,
  type ReconcileAccountInput,
  type UpdateAccountInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { AccountsService } from "./accounts.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("includeArchived") includeArchived?: string
  ): Promise<Account[]> {
    return this.accounts.list(user.userId, workspaceId, includeArchived === "true");
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createAccountInputSchema)) body: CreateAccountInput
  ): Promise<Account> {
    return this.accounts.create(user.userId, workspaceId, body);
  }

  @Patch(":accountId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("accountId") accountId: string,
    @Body(new ZodValidationPipe(updateAccountInputSchema)) body: UpdateAccountInput
  ): Promise<Account> {
    return this.accounts.update(user.userId, workspaceId, accountId, body);
  }

  @Post(":accountId/reconcile")
  reconcile(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("accountId") accountId: string,
    @Body(new ZodValidationPipe(reconcileAccountInputSchema)) body: ReconcileAccountInput
  ): Promise<Account> {
    return this.accounts.reconcile(user.userId, workspaceId, accountId, body.actualBalance);
  }

  @Delete(":accountId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("accountId") accountId: string
  ): Promise<void> {
    return this.accounts.remove(user.userId, workspaceId, accountId);
  }
}
