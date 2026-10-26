import { Module } from "@nestjs/common";
import { InventoryHomeLinksQueries } from "../inventory-home-links.service";
import { InventoryHomeLinks } from "./inventory-home-links";

@Module({ providers: [{ provide: InventoryHomeLinks, useClass: InventoryHomeLinksQueries }], exports: [InventoryHomeLinks] })
export class InventoryHomeLinksModule {}
