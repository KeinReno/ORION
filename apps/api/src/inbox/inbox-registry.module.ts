import { Module } from "@nestjs/common";
import { InboxTargetRegistry } from "./inbox-target.registry";

@Module({ providers: [InboxTargetRegistry], exports: [InboxTargetRegistry] })
export class InboxRegistryModule {}
