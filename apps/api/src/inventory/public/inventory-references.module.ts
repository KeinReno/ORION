import { Module } from "@nestjs/common";
import { InventoryReferenceQueries } from "../inventory-references.service";
import { InventoryReferences } from "./inventory-references";

@Module({ providers: [{ provide: InventoryReferences, useClass: InventoryReferenceQueries }], exports: [InventoryReferences] })
export class InventoryReferencesModule {}
