import { Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import {
  LAN_PAIR_SECRET_HEADER,
  lanApprovePairInputSchema,
  lanClientConnectInputSchema,
  lanEnableHostInputSchema,
  lanPairRequestInputSchema,
  type LanApprovePairInput,
  type LanClientConnectInput,
  type LanClientPairing,
  type LanClientStatus,
  type LanDevice,
  type LanDiscoveredNode,
  type LanEnableHostInput,
  type LanHostStatus,
  type LanNodeCard,
  type LanPairRequestCreated,
  type LanPairRequestInput,
  type LanPairStatus,
  type LanPendingPair,
  type LanPinAccount
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { isLoopbackAddress } from "./device-trust.middleware";
import { LanService } from "./lan.service";
import { PairingError } from "./pairing-registry";
import { BadRequestException, ConflictException, HttpException, NotFoundException } from "@nestjs/common";

/** Управление узлом — только с самой машины: «владелец подтверждает» значит «сидит за этим компьютером». */
@Injectable()
export class LoopbackOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!isLoopbackAddress(request.socket.remoteAddress)) throw new ForbiddenException("Управление узлом доступно только с самого компьютера-хоста");
    return true;
  }
}

const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });

function mapPairing<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PairingError) {
      if (error.status === 404) throw new NotFoundException({ statusCode: 404, code: error.code, message: error.message });
      if (error.status === 409) throw new ConflictException({ statusCode: 409, code: error.code, message: error.message });
      if (error.status === 429) throw new HttpException({ statusCode: 429, code: error.code, message: error.message }, 429);
      throw new BadRequestException({ statusCode: 400, code: error.code, message: error.message });
    }
    throw error;
  }
}

@Controller("lan")
export class LanController {
  constructor(private readonly lan: LanService) {}

  // ───────── без авторизации: визитка, заявка, опрос ─────────

  /** Единственное, что узел показывает чужому: имя, nodeId, отпечаток. Никаких пользователей и пространств. */
  @Get("info")
  info(): LanNodeCard {
    return this.lan.card();
  }

  @Post("pair/request")
  request(@Req() req: Request, @Body(new ZodValidationPipe(lanPairRequestInputSchema)) body: LanPairRequestInput): LanPairRequestCreated {
    return mapPairing(() => this.lan.createPairRequest(body, req.socket.remoteAddress ?? "unknown"));
  }

  @Get("pair/status/:id")
  status(@Param("id") id: string, @Req() req: Request): LanPairStatus {
    const header = req.headers[LAN_PAIR_SECRET_HEADER];
    return this.lan.pairStatus(id, Array.isArray(header) ? header[0] : header);
  }

  /** Проверка «моё устройство ещё доверенное»: доходит сюда только с действующим device-токеном (или с loopback). */
  @Get("ping")
  ping(): { ok: true } {
    return { ok: true };
  }

  // ───────── хост (владелец, с этого компьютера) ─────────

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Get("host")
  host(): Promise<LanHostStatus> {
    return this.lan.hostStatus();
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Get("host/pin-accounts")
  pinAccounts(): Promise<LanPinAccount[]> {
    return this.lan.pinAccounts();
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Post("host/enable")
  enable(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(lanEnableHostInputSchema)) body: LanEnableHostInput): Promise<{ restarting: boolean; status: LanHostStatus }> {
    return this.lan.enableHost(user.userId, body);
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Post("host/disable")
  disable(@CurrentUser() user: RequestUser): Promise<{ restarting: boolean; status: LanHostStatus }> {
    return this.lan.disableHost(user.userId);
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Patch("host")
  rename(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(renameSchema)) body: { name: string }): Promise<LanHostStatus> {
    this.assertOwner(user);
    return this.lan.renameNode(body.name);
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Post("host/firewall")
  async firewall(@CurrentUser() user: RequestUser): Promise<{ ok: boolean }> {
    this.assertOwner(user);
    return { ok: await this.lan.openFirewall() };
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Delete("host/firewall")
  async closeFirewall(@CurrentUser() user: RequestUser): Promise<{ ok: boolean }> {
    this.assertOwner(user);
    return { ok: await this.lan.closeFirewall() };
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Get("host/devices")
  devices(@CurrentUser() user: RequestUser): LanDevice[] {
    this.assertOwner(user);
    return this.lan.listDevices();
  }

  @HttpCode(204)
  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Delete("host/devices/:id")
  revoke(@CurrentUser() user: RequestUser, @Param("id") id: string): void {
    this.assertOwner(user);
    this.lan.revokeDevice(id);
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Get("host/pairs")
  pairs(@CurrentUser() user: RequestUser): LanPendingPair[] {
    this.assertOwner(user);
    return this.lan.listPending();
  }

  @HttpCode(204)
  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Post("host/pairs/:id/approve")
  approve(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(lanApprovePairInputSchema)) body: LanApprovePairInput): void {
    this.assertOwner(user);
    mapPairing(() => this.lan.registry.approve(id, body.code));
  }

  @HttpCode(204)
  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Post("host/pairs/:id/deny")
  deny(@CurrentUser() user: RequestUser, @Param("id") id: string): void {
    this.assertOwner(user);
    mapPairing(() => this.lan.registry.deny(id));
  }

  // ───────── клиент (локальный API этого компьютера) ─────────

  /** Режим и состояние связи нужны окну до входа в аккаунт, поэтому без JWT; только loopback и без секретов. */
  @UseGuards(LoopbackOnlyGuard)
  @Get("client/status")
  clientStatus(): Promise<LanClientStatus> {
    return this.lan.clientStatus();
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Get("client/discover")
  discover(): Promise<LanDiscoveredNode[]> {
    return this.lan.discover();
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Post("client/pair")
  startPair(@Body(new ZodValidationPipe(lanClientConnectInputSchema)) body: LanClientConnectInput): Promise<LanClientPairing> {
    return this.lan.startPairing(body);
  }

  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Get("client/pair/:id")
  pollPair(@Param("id") id: string): Promise<LanClientPairing> {
    return this.lan.pollPairing(id);
  }

  @HttpCode(204)
  @UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
  @Post("client/activate")
  activate(): void {
    this.lan.activateClient();
  }

  /** Вход в «Клиент LAN» с экрана входа (локальной сессии ещё нет) невозможен, а возврат в «Локальный» нужен именно оттуда. */
  @HttpCode(204)
  @UseGuards(LoopbackOnlyGuard)
  @Post("client/deactivate")
  deactivate(): void {
    this.lan.deactivateClient();
  }

  @HttpCode(204)
  @UseGuards(LoopbackOnlyGuard)
  @Delete("client/binding")
  forget(): void {
    this.lan.forgetBinding();
  }

  private assertOwner(user: RequestUser): void {
    if (!this.lan.isOwner(user.userId)) throw new ForbiddenException("Узлом управляет его владелец");
  }
}
