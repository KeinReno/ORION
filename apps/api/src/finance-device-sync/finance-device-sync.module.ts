import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FinanceDeviceReplicationModule } from "../finance/public/device-replication.module";
import { FinanceDeviceSyncController } from "./finance-device-sync.controller";
/** Host composition imports this optional API adapter; Finance Base does not. */
@Module({imports:[AuthModule,FinanceDeviceReplicationModule],controllers:[FinanceDeviceSyncController]})
export class FinanceDeviceSyncModule {}
