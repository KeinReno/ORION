import { Module } from "@nestjs/common";
import { ObligationHomeLinksQueries } from "../obligation-home-links.service";
import { ObligationHomeLinks } from "./obligation-home-links";

@Module({ providers: [{ provide: ObligationHomeLinks, useClass: ObligationHomeLinksQueries }], exports: [ObligationHomeLinks] })
export class ObligationHomeLinksModule {}
