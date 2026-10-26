import { Module } from "@nestjs/common";
import { GoalReferencesQueries } from "../goal-references.service";
import { GoalReferences } from "./goal-references";

@Module({ providers: [{ provide: GoalReferences, useClass: GoalReferencesQueries }], exports: [GoalReferences] })
export class GoalReferencesModule {}
