import { Module } from "@nestjs/common";
import { GoalTaskQueries } from "../goal-task-reader.service";
import { GoalTaskReader } from "./goal-task-reader";

/** Projection SDK only; no domain module or lifecycle providers. */
@Module({ providers: [{ provide: GoalTaskReader, useClass: GoalTaskQueries }], exports: [GoalTaskReader] })
export class GoalTaskReaderModule {}
