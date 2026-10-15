import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  SYNC_PROTOCOL_VERSION,
  pushSyncOpsInputSchema,
  registerSyncDeviceInputSchema,
  setSyncModeInputSchema,
  type PushSyncOpsInput,
  type PushSyncOpsResult,
  type RegisterSyncDeviceInput,
  type ReplicaPull,
  type ReplicaSnapshot,
  type SetSyncModeInput,
  type SyncDevice,
  type SyncModeState
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HybridSyncService } from "./hybrid-sync.service";

function protocolOf(value: string | undefined): number {
  const parsed = Number(value ?? SYNC_PROTOCOL_VERSION);
  if (!Number.isInteger(parsed)) throw new BadRequestException("protocol должен быть целым числом");
  return parsed;
}

/** ТЗ-06: режим пространства, локальная копия и очередь операций. Маршруты — `workspaces/:id/sync/...` рядом с бэкапом. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/sync")
export class HybridSyncController {
  constructor(private readonly hybrid: HybridSyncService) {}

  @Get("mode")
  mode(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<SyncModeState> {
    return this.hybrid.getMode(user.userId, workspaceId);
  }

  @Put("mode")
  setMode(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(setSyncModeInputSchema)) body: SetSyncModeInput
  ): Promise<SyncModeState> {
    return this.hybrid.setMode(user.userId, workspaceId, body.mode);
  }

  @Get("replica")
  replica(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("protocol") protocol?: string
  ): Promise<ReplicaSnapshot> {
    return this.hybrid.snapshot(user.userId, workspaceId, protocolOf(protocol));
  }

  @Get("replica/changes")
  changes(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("cursor") cursor?: string,
    @Query("protocol") protocol?: string
  ): Promise<ReplicaPull> {
    return this.hybrid.pull(user.userId, workspaceId, cursor ?? "", protocolOf(protocol));
  }

  @Post("ops")
  push(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(pushSyncOpsInputSchema)) body: PushSyncOpsInput
  ): Promise<PushSyncOpsResult> {
    return this.hybrid.push(user.userId, workspaceId, body);
  }
}

/** Устройства принадлежат пользователю, а не пространству. */
@UseGuards(JwtAuthGuard)
@Controller("sync/devices")
export class SyncDevicesController {
  constructor(private readonly hybrid: HybridSyncService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<SyncDevice[]> {
    return this.hybrid.listDevices(user.userId);
  }

  @Post()
  register(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(registerSyncDeviceInputSchema)) body: RegisterSyncDeviceInput
  ): Promise<SyncDevice> {
    return this.hybrid.registerDevice(user.userId, body);
  }

  @Delete(":deviceId")
  revoke(@CurrentUser() user: RequestUser, @Param("deviceId") deviceId: string): Promise<SyncDevice> {
    return this.hybrid.revokeDevice(user.userId, deviceId);
  }
}
