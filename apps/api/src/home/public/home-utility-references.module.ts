import { Module } from "@nestjs/common";
import { HomeUtilityReferenceQueries } from "../home-utility-references.service";
import { HomeUtilityReferences } from "./home-utility-references";

@Module({ providers: [{ provide: HomeUtilityReferences, useClass: HomeUtilityReferenceQueries }], exports: [HomeUtilityReferences] })
export class HomeUtilityReferencesModule {}
