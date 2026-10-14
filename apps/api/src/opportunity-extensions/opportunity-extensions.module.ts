import { Module } from "@nestjs/common";
import { ProfilesModule } from "../opportunities-profiles/public";
import { HhImportModule } from "../opportunities-hh-import/hh-import.module";
/** Composition boundary: Base does not import its concrete extensions. */
@Module({ imports: [ProfilesModule, HhImportModule] })
export class OpportunityExtensionsModule {}
