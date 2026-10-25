import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Post, Put, UseGuards } from "@nestjs/common";
import { setAppUpdateConfigInputSchema, type AppUpdateConfig, type AppUpdateStatus, type SetAppUpdateConfigInput } from "@orion/shared-types";
import type { Request } from "express";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { UpdateService } from "./update.service";

/**
 * Изменяющие запросы принимаются только как `application/json`. Такой запрос из чужой веб-страницы требует предварительной
 * проверки CORS (`OPTIONS`), которую API пропускает только для своих источников, — значит страница в браузере не сможет
 * дёрнуть «установить обновление» на этом компьютере.
 */
@Injectable()
export class JsonBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.is("application/json")) throw new ForbiddenException("Ожидается запрос application/json");
    return true;
  }
}

/**
 * Обновления программы. Только с этого компьютера (`LoopbackOnlyGuard`): окно ORION всегда ходит сюда напрямую, в том числе в
 * режиме клиента LAN, где остальной API проксируется на хост, а JWT хоста локальный сервис проверить не может.
 */
@UseGuards(LoopbackOnlyGuard)
@Controller("updates")
export class UpdatesController {
  constructor(private readonly updates: UpdateService) {}

  @Get("status")
  status(): AppUpdateStatus {
    return this.updates.getStatus();
  }

  @Get("config")
  config(): AppUpdateConfig {
    return this.updates.getConfig();
  }

  @UseGuards(JsonBodyGuard)
  @Put("config")
  setConfig(@Body(new ZodValidationPipe(setAppUpdateConfigInputSchema)) body: SetAppUpdateConfigInput): AppUpdateConfig {
    return this.updates.setConfig(body);
  }

  @UseGuards(JsonBodyGuard)
  @Post("check")
  @HttpCode(200)
  check(): Promise<AppUpdateStatus> {
    return this.updates.check();
  }

  @UseGuards(JsonBodyGuard)
  @Post("download")
  @HttpCode(200)
  download(): Promise<AppUpdateStatus> {
    return this.updates.download();
  }

  @UseGuards(JsonBodyGuard)
  @Post("apply")
  @HttpCode(202)
  apply(): Promise<{ started: true }> {
    return this.updates.apply();
  }

  @UseGuards(JsonBodyGuard)
  @Post("ui-ready")
  @HttpCode(200)
  uiReady(@Body() body: { tag?: unknown }): { accepted: boolean } {
    return this.updates.acknowledgeUi(typeof body?.tag === "string" ? body.tag : "");
  }
}
