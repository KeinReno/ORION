import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createKeyBindingInputSchema,
  updateKeyBindingInputSchema,
  type CreateKeyBindingInput,
  type KeyBindingList,
  type KeyBindingWriteResult,
  type UpdateKeyBindingInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { KeyBindingsService } from "./key-bindings.service";

/**
 * Личные горячие клавиши участника. Путь workspace-scoped, потому что привязки
 * принадлежат пространству и пользователю (RLS + `userId` в каждом запросе).
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/key-bindings")
export class KeyBindingsController {
  constructor(private readonly bindings: KeyBindingsService) {}

  @Get()
  @RequirePermission("core.command.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<KeyBindingList> {
    return this.bindings.list(user.userId, workspaceId);
  }

  @Post()
  @RequirePermission("core.key_binding.manage")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createKeyBindingInputSchema)) body: CreateKeyBindingInput
  ): Promise<KeyBindingWriteResult> {
    return this.bindings.create(user.userId, workspaceId, body);
  }

  @Patch(":bindingId")
  @RequirePermission("core.key_binding.manage")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("bindingId") bindingId: string,
    @Body(new ZodValidationPipe(updateKeyBindingInputSchema)) body: UpdateKeyBindingInput
  ): Promise<KeyBindingWriteResult> {
    return this.bindings.update(user.userId, workspaceId, bindingId, body);
  }

  @Delete(":bindingId")
  @HttpCode(204)
  @RequirePermission("core.key_binding.manage")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("bindingId") bindingId: string
  ): Promise<void> {
    await this.bindings.remove(user.userId, workspaceId, bindingId);
  }
}
