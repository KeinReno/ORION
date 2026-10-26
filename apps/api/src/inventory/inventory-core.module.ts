import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { InventoryService } from "./inventory.service";
import { InventoryAlertsService } from "./inventory-alerts.service";

@Module({ imports: [WorkspacesModule, NotificationsModule, ProjectReferencesModule], providers: [InventoryService, InventoryAlertsService], exports: [InventoryService] })
export class InventoryCoreModule {}
