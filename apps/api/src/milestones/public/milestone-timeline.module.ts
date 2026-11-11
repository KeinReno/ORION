import { Module } from "@nestjs/common";
import { MilestoneTimelineQueries } from "../milestone-timeline.service";
import { MilestoneTimelineReader } from "./milestone-timeline";

/** SDK только для чтения: без MilestonesModule, контроллеров и фоновых задач. */
@Module({
  providers: [{ provide: MilestoneTimelineReader, useClass: MilestoneTimelineQueries }],
  exports: [MilestoneTimelineReader]
})
export class MilestoneTimelineModule {}
