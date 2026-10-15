import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createObligationInputSchema,
  payObligationInputSchema,
  updateObligationInputSchema,
  type CreateObligationInput,
  type Obligation,
  type PayObligationInput,
  type Transaction,
  type UpdateObligationInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { RequirePlugin } from "../../plugins/require-plugin";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { ObligationsService } from "./obligations.service";

@RequireModule("finance")
@RequirePlugin("finance-obligations")
@Controller("workspaces/:workspaceId/finance/obligations")
export class ObligationsController {
  constructor(private readonly obligations: ObligationsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<Obligation[]> {
    return this.obligations.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createObligationInputSchema)) body: CreateObligationInput
  ): Promise<Obligation> {
    return this.obligations.create(user.userId, workspaceId, body);
  }

  @Patch(":obligationId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("obligationId") obligationId: string,
    @Body(new ZodValidationPipe(updateObligationInputSchema)) body: UpdateObligationInput
  ): Promise<Obligation> {
    return this.obligations.update(user.userId, workspaceId, obligationId, body);
  }

  /** Records the payment as a real transaction and moves the plan on. */
  @Post(":obligationId/pay")
  @HttpCode(201)
  pay(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("obligationId") obligationId: string,
    @Body(new ZodValidationPipe(payObligationInputSchema)) body: PayObligationInput
  ): Promise<{ obligation: Obligation; transaction: Transaction }> {
    return this.obligations.pay(user.userId, workspaceId, obligationId, body);
  }

  @Get(":obligationId/payments")
  payments(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("obligationId") obligationId: string
  ): Promise<Transaction[]> {
    return this.obligations.payments(user.userId, workspaceId, obligationId);
  }

  @Delete(":obligationId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("obligationId") obligationId: string
  ): Promise<void> {
    return this.obligations.remove(user.userId, workspaceId, obligationId);
  }
}
