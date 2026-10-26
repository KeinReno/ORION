import { Module } from "@nestjs/common";
import { ListHomeLinksQueries } from "../list-home-links.service";
import { ListHomeLinks } from "./list-home-links";

@Module({ providers: [{ provide: ListHomeLinks, useClass: ListHomeLinksQueries }], exports: [ListHomeLinks] })
export class ListHomeLinksModule {}
