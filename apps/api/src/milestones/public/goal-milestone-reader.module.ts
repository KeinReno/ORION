import { Module } from "@nestjs/common";
import { GoalMilestoneQueries } from "../goal-milestone-reader.service";
import { GoalMilestoneReader } from "./goal-milestone-reader";

/** Projection SDK only; no domain module or lifecycle providers. */
@Module({ providers: [{ provide: GoalMilestoneReader, useClass: GoalMilestoneQueries }], exports: [GoalMilestoneReader] })
export class GoalMilestoneReaderModule {}
