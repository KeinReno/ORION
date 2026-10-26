import { Module } from "@nestjs/common";
import { ProjectAgentQueries } from "../project-agent-reader.service";
import { ProjectAgentReader } from "./project-agent-reader";

@Module({ providers: [{ provide: ProjectAgentReader, useClass: ProjectAgentQueries }], exports: [ProjectAgentReader] })
export class ProjectAgentReaderModule {}
