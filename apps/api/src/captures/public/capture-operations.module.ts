import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { TaskOperationsModule } from "../../tasks/public/task-operations.module";
import { ProjectReferencesModule } from "../../projects/public/project-references.module";
import { TaskIntegrationReaderModule } from "../../tasks/public/task-integration-reader.module";
import { GoalReferencesModule } from "../../goals/public/goal-references.module";
import { HomeReferencesModule } from "../../home/public/home-references.module";
import { FinanceAnchorReferencesModule } from "../../finance/public/finance-anchor-references.module";
import { ContactReferencesModule } from "../../contacts/public/contact-references.module";
import { CapturesService } from "../captures.service";
import { CaptureOperations } from "./capture-operations";

/** Commands and scoped references only; no controllers or reference-move registrations. */
@Module({
  imports: [WorkspacesModule, TaskOperationsModule, ProjectReferencesModule, TaskIntegrationReaderModule, GoalReferencesModule, HomeReferencesModule, FinanceAnchorReferencesModule, ContactReferencesModule],
  providers: [CapturesService, { provide: CaptureOperations, useFactory: (service: CapturesService): CaptureOperations => service, inject: [CapturesService] }],
  exports: [CaptureOperations, CapturesService]
})
export class CaptureOperationsModule {}
