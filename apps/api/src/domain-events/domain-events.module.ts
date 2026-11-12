import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DomainEventBus } from "./domain-event-bus";
import { DomainEventDispatcherService } from "./domain-event-dispatcher.service";
import { DomainEventsController } from "./domain-events.controller";

@Global()
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [DomainEventsController],
  providers: [DomainEventBus, DomainEventDispatcherService],
  exports: [DomainEventBus, DomainEventDispatcherService]
})
export class DomainEventsModule {}
