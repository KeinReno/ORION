import { Module } from "@nestjs/common";
import { MilestoneReferenceQueries } from "../milestone-references.service";
import { MilestoneReferences } from "./milestone-references";

/** SDK only; no full domain module or lifecycle side effects. */
@Module({ providers: [{ provide: MilestoneReferences, useClass: MilestoneReferenceQueries }], exports: [MilestoneReferences] })
export class MilestoneReferencesModule {}
