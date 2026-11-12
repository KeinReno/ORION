import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DomainEventsModule } from "../domain-events/domain-events.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { MilestonesController } from "./milestones.controller";
import { MilestonesService } from "./milestones.service";
import { MilestonesProjectAggregates } from "./milestones-project-aggregates";

/** ORION v0.27 «План проекта» — вехи и их зависимости. */
@Module({
  // MilestonesService публикует доменные события (проектный журнал слушает их), поэтому
  // модуль объявляет зависимость от шины, а не полагается на импорт в большом приложении:
  // иначе композиция без AppModule (тест публичного контракта) падает на DI.
  imports: [ProjectReferencesModule, AuthModule, WorkspacesModule, DomainEventsModule],
  controllers: [MilestonesController],
  providers: [MilestonesProjectAggregates, MilestonesService]
})
export class MilestonesModule {}
