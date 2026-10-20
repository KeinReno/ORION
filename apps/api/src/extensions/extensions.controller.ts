import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import {
  approveExtensionInputSchema,
  updateExtensionInputSchema,
  type ApproveExtensionInput,
  type ExtensionInfo,
  type ExtensionsState,
  type UpdateExtensionInput
} from "@orion/shared-types";
import type { Response } from "express";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { JsonBodyGuard } from "../updates/updates.controller";
import type { RequestUser } from "../auth/jwt.strategy";
import { ExtensionsService } from "./extensions.service";

/**
 * Расширения из папки (ADR-0022, E2). Всё — только с этого компьютера (`LoopbackOnlyGuard`): папка и подтверждения
 * принадлежат установке, а не сети; изменяющие запросы — только JSON (как обновления), чтобы чужая страница в браузере не
 * подтвердила расширение за пользователя.
 */
@UseGuards(LoopbackOnlyGuard)
@Controller("extensions")
export class ExtensionsController {
  constructor(private readonly extensions: ExtensionsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  state(@CurrentUser() user: RequestUser): Promise<ExtensionsState> {
    return this.extensions.state(user.userId);
  }

  @UseGuards(JwtAuthGuard, JsonBodyGuard)
  @Post(":id/approve")
  @HttpCode(200)
  approve(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(approveExtensionInputSchema)) body: ApproveExtensionInput
  ): Promise<ExtensionInfo> {
    return this.extensions.approve(user.userId, id, body);
  }

  @UseGuards(JwtAuthGuard, JsonBodyGuard)
  @Patch(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExtensionInputSchema)) body: UpdateExtensionInput
  ): Promise<ExtensionInfo> {
    return this.extensions.update(user.userId, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(":id/approval")
  @HttpCode(204)
  revoke(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<void> {
    return this.extensions.revoke(user.userId, id);
  }

  @UseGuards(JwtAuthGuard, JsonBodyGuard)
  @Post("open-folder")
  @HttpCode(200)
  openFolder(@CurrentUser() user: RequestUser): Promise<{ dir: string }> {
    return this.extensions.openFolder(user.userId);
  }

  /**
   * Код подтверждённого расширения для `import()` интерфейса. Без JWT: модульный скрипт браузер грузит без заголовка
   * авторизации; это код, а не данные пользователя, и отдаётся только этому компьютеру и только подтверждённый.
   */
  @Get(":id/web.js")
  entry(@Param("id") id: string, @Res() res: Response): void {
    const code = this.extensions.entry(id);
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(code);
  }
}
