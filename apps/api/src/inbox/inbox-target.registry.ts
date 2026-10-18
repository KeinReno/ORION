import { Injectable } from "@nestjs/common";
import type { InboxTarget } from "./inbox-target";

/** Реестр целей «превратить входящее в X» (отдельный модуль — по той же причине, что `SearchRegistryModule`: без циклов). */
@Injectable()
export class InboxTargetRegistry {
  private readonly byKind = new Map<InboxTarget["kind"], InboxTarget>();

  register(target: InboxTarget): void {
    if (this.byKind.has(target.kind)) throw new Error(`Цель входящих «${target.kind}» уже зарегистрирована`);
    this.byKind.set(target.kind, target);
  }

  get(kind: string): InboxTarget | undefined {
    return this.byKind.get(kind as InboxTarget["kind"]);
  }
}
