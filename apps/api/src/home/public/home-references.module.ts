import { Module } from "@nestjs/common";
import { HomeReferencesQueries } from "../home-references.service";
import { HomeReferences } from "./home-references";

@Module({ providers: [{ provide: HomeReferences, useClass: HomeReferencesQueries }], exports: [HomeReferences] })
export class HomeReferencesModule {}
