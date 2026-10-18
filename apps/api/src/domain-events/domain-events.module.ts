import { Global, Module } from "@nestjs/common";
import { DomainEventBus } from "./domain-event-bus";
import { DomainEventDispatcherService } from "./domain-event-dispatcher.service";

@Global()
@Module({
  providers: [DomainEventBus, DomainEventDispatcherService],
  exports: [DomainEventBus, DomainEventDispatcherService]
})
export class DomainEventsModule {}
