import { Module } from "@nestjs/common";
import { TaskHomeLinksQueries } from "../task-home-links.service";
import { TaskHomeLinks } from "./task-home-links";

@Module({ providers: [{ provide: TaskHomeLinks, useClass: TaskHomeLinksQueries }], exports: [TaskHomeLinks] })
export class TaskHomeLinksModule {}
