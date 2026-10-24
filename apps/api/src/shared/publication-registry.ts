import { Global, Injectable, Module, ServiceUnavailableException } from "@nestjs/common";
import type { PublicationKind } from "@orion/shared-types";
import type { PublicationAdapter } from "./publication-contracts";
@Injectable()
export class PublicationRegistry {
  private readonly adapters = new Map<PublicationKind, PublicationAdapter>();
  register(adapter: PublicationAdapter) {
    if (this.adapters.has(adapter.kind)) throw new Error(`Duplicate publication adapter: ${adapter.kind}`);
    this.adapters.set(adapter.kind, adapter);
  }
  get(kind: PublicationKind): PublicationAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new ServiceUnavailableException("Модуль публикации недоступен");
    return adapter;
  }
}
@Global()
@Module({ providers: [PublicationRegistry], exports: [PublicationRegistry] })
export class PublicationRegistryModule {}
