import { Body, Controller, Get, Headers, HttpException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  lanApprovePairInputSchema,
  sendAcceptInputSchema,
  sendCopyInputSchema,
  sendDocumentsInputSchema,
  sendEnableInputSchema,
  sendManualInputSchema,
  sendOutgoingInputSchema,
  sendPairInputSchema,
  sendPathsInputSchema,
  type LanApprovePairInput,
  type SendAcceptInput,
  type SendCopyInput,
  type SendDocumentsInput,
  type SendEnableInput,
  type SendManualInput,
  type SendOutgoingInput,
  type SendPairInput,
  type SendPathsInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { SendFailure } from "./send-sessions";
import { SendService } from "./send.service";

function asHttp(error: unknown): never {
  if (error instanceof SendFailure) throw new HttpException({ statusCode: error.status, code: error.code, message: error.message }, error.status);
  throw error;
}

/** Управление передачей только с этого компьютера. Сами байты ходят отдельным TLS-портом, не через эти маршруты. */
@Controller("send")
@UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
export class SendController {
  constructor(private readonly send: SendService) {}

  @Get("status")
  status() {
    return this.send.link.status();
  }

  @Post("enable")
  enable(@Body(new ZodValidationPipe(sendEnableInputSchema)) body: SendEnableInput) {
    return this.send.enable(body).catch(asHttp);
  }

  @Post("firewall")
  async firewall() {
    return { ok: await this.send.link.openFirewall() };
  }

  @Get("discover")
  discover(@Query("scan") scan?: string) {
    return this.send.link.discover(scan === "1").catch(asHttp);
  }

  @Post("discover")
  manual(@Body(new ZodValidationPipe(sendManualInputSchema)) body: SendManualInput) {
    return this.send.link.probeManual(body.address, body.port).catch(asHttp);
  }

  @Get("peers")
  peers() {
    return this.send.link.peersView();
  }

  @Post("peers/pair")
  pair(@Body(new ZodValidationPipe(sendPairInputSchema)) body: SendPairInput) {
    return this.send.pair(body).catch(asHttp);
  }

  @Get("peers/pair/:id")
  refresh(@Param("id") id: string) {
    return this.send.link.refreshPair(id).catch(asHttp);
  }

  @Get("peers/requests")
  requests() {
    return this.send.link.listPending();
  }

  @Post("peers/requests/:id/approve")
  approve(@Param("id") id: string, @Body(new ZodValidationPipe(lanApprovePairInputSchema)) body: LanApprovePairInput) {
    try {
      this.send.link.approve(id, body.code);
      return { ok: true };
    } catch (error) {
      asHttp(error);
    }
  }

  @Post("peers/requests/:id/deny")
  deny(@Param("id") id: string) {
    try {
      this.send.link.deny(id);
      return { ok: true };
    } catch (error) {
      asHttp(error);
    }
  }

  @Post("peers/:id/revoke")
  revoke(@Param("id") id: string) {
    return { ok: this.send.link.revoke(id) };
  }

  @Get("transfers")
  transfers() {
    return this.send.link.transfers();
  }

  @Post("transfers/:id/accept")
  accept(@Param("id") id: string, @Body(new ZodValidationPipe(sendAcceptInputSchema)) body: SendAcceptInput) {
    return this.send.link.accept(id, body.directory).catch(asHttp);
  }

  @Post("transfers/:id/reject")
  reject(@Param("id") id: string) {
    try {
      return this.send.link.reject(id);
    } catch (error) {
      asHttp(error);
    }
  }

  @Post("transfers/:id/pause")
  pause(@Param("id") id: string) {
    try {
      return this.send.link.pause(id);
    } catch (error) {
      asHttp(error);
    }
  }

  @Post("transfers/:id/resume")
  resume(@Param("id") id: string) {
    try {
      return this.send.link.resume(id);
    } catch (error) {
      asHttp(error);
    }
  }

  @Post("transfers/:id/cancel")
  cancel(@Param("id") id: string) {
    return this.send.link.cancel(id).catch(asHttp);
  }

  @Post("outbox")
  stage(@Req() req: Request, @Headers("x-orion-relative-path") relativePath?: string, @Headers("x-orion-batch") batchId?: string) {
    return this.send.stage(decodeURIComponent(relativePath ?? ""), req, batchId).catch(asHttp);
  }

  @Post("outgoing")
  outgoing(@Body(new ZodValidationPipe(sendOutgoingInputSchema)) body: SendOutgoingInput) {
    return this.send.link.offerBatch(body.peerId, body.batchId).catch(asHttp);
  }

  @Post("paths")
  paths(@Body(new ZodValidationPipe(sendPathsInputSchema)) body: SendPathsInput) {
    return this.send.sendPaths(body).catch(asHttp);
  }

  @Post("documents")
  documents(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(sendDocumentsInputSchema)) body: SendDocumentsInput) {
    return this.send.sendDocuments(user.userId, body).catch(asHttp);
  }

  @Post("copies")
  copies(@Body(new ZodValidationPipe(sendCopyInputSchema)) body: SendCopyInput) {
    return this.send.sendCopy(body).catch(asHttp);
  }
}
