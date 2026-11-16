import { Body, Controller, Get, Patch, Param } from "@nestjs/common";
import { updateFinanceSettingsInputSchema, type FinanceSettings, type UpdateFinanceSettingsInput } from "@orion/shared-types";
import { RequireModule } from "../modules/require-module";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { FinanceSettingsService } from "./finance-settings.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/settings")
export class FinanceSettingsController {
  constructor(private readonly settings: FinanceSettingsService) {}

  @Get()
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<FinanceSettings> {
    return this.settings.get(user.userId, workspaceId);
  }

  @Patch()
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(updateFinanceSettingsInputSchema)) body: UpdateFinanceSettingsInput
  ): Promise<FinanceSettings> {
    return this.settings.update(user.userId, workspaceId, body);
  }
}
