import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { financeDeviceCommandSchema, type FinanceDeviceCommand } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePlugin } from "../plugins/require-plugin";
import { RequireModule } from "../modules/require-module";
import { FinanceDeviceReplication } from "../finance/public/device-replication";
@RequirePlugin("finance-device-sync")
@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/device-sync/v1")
export class FinanceDeviceSyncController {
    constructor(private readonly sdk: FinanceDeviceReplication) { }
    @Get("capability")
    capability(
    @CurrentUser()
    user: RequestUser, 
    @Param("workspaceId")
    ws: string) {
        return this.sdk.capability(user.userId, ws);
    }
    @Get("snapshot")
    snapshot(
    @CurrentUser()
    user: RequestUser, 
    @Param("workspaceId")
    ws: string, 
    @Query("deviceId", new ZodValidationPipe(z.string().uuid()))
    deviceId: string) {
        return this.sdk.snapshot(user.userId, ws, deviceId);
    }
    @Post("commands")
    command(
    @CurrentUser()
    user: RequestUser, 
    @Param("workspaceId")
    ws: string, 
    @Body(new ZodValidationPipe(financeDeviceCommandSchema))
    command: FinanceDeviceCommand) {
        return this.sdk.command(user.userId, ws, command);
    }
}
