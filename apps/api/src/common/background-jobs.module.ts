import { Global, Module } from "@nestjs/common";
import { BackgroundJobRegistry } from "./background-job-registry";
import { BackgroundJobSupervisor } from "./background-job-supervisor";
import { BackgroundJobsService } from "./background-jobs.service";

/** Глобальный, как PrismaModule: каждая крон-служба обязана ходить через него, импортов в модулях не нужно. */
@Global()
@Module({
  providers: [BackgroundJobsService, BackgroundJobRegistry, BackgroundJobSupervisor],
  exports: [BackgroundJobsService, BackgroundJobRegistry, BackgroundJobSupervisor]
})
export class BackgroundJobsModule {}
