import { Global, Module } from "@nestjs/common";
import { BackgroundJobsService } from "./background-jobs.service";

/** Глобальный, как PrismaModule: каждая крон-служба обязана ходить через него, импортов в модулях не нужно. */
@Global()
@Module({
  providers: [BackgroundJobsService],
  exports: [BackgroundJobsService]
})
export class BackgroundJobsModule {}
