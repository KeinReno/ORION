import { Global, HttpException, Injectable, InternalServerErrorException, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Public transaction-scoped extension point. Core does not know which domains must revoke authority. */
export interface CapabilityChange { kind: "module" | "plugin"; id: string; enabled: boolean; workspaceId: string; actorId: string }

/**
 * Хуки жизненного цикла одного компонента (PLATFORM_AUDIT G6). Вызываются внутри той же транзакции, что и само
 * переключение: исключение откатывает переключение целиком. Хук идемпотентен и не должен писать за пределы
 * `ctx.workspaceId`.
 */
export interface ComponentLifecycleContext { kind: "module" | "plugin"; id: string; workspaceId: string; actorId: string }
export interface ComponentLifecycle {
  onEnable?(tx: Prisma.TransactionClient, ctx: ComponentLifecycleContext): Promise<void>;
  onDisable?(tx: Prisma.TransactionClient, ctx: ComponentLifecycleContext): Promise<void>;
}
type Handler = (tx: Prisma.TransactionClient, change: CapabilityChange) => Promise<void>;
@Injectable()
export class CapabilityLifecycle {
  private readonly handlers = new Map<string, Handler>();
  private readonly components = new Map<string, ComponentLifecycle>();
  /** Реестр по `componentId` (id модуля или плагина). Один набор хуков на компонент. */
  registerComponent(componentId: string, hooks: ComponentLifecycle): void {
    if (this.components.has(componentId)) throw new Error(`Duplicate component lifecycle: ${componentId}`);
    this.components.set(componentId, hooks);
  }
  unregisterComponent(componentId: string): void {
    this.components.delete(componentId);
  }
  register(id: string, handler: Handler): void {
    if (this.handlers.has(id)) throw new Error(`Duplicate capability lifecycle contribution: ${id}`);
    this.handlers.set(id, handler);
  }
  async changedTx(tx: Prisma.TransactionClient, change: CapabilityChange): Promise<void> {
    for (const handler of this.handlers.values()) await handler(tx, change);
    const hooks = this.components.get(change.id);
    const hook = change.enabled ? hooks?.onEnable : hooks?.onDisable;
    if (!hook) return;
    try {
      await hook.call(hooks, tx, { kind: change.kind, id: change.id, workspaceId: change.workspaceId, actorId: change.actorId });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Не удалось ${change.enabled ? "включить" : "выключить"} компонент «${change.id}»: ${reason}. Изменение отменено.`
      );
    }
  }
}
@Global()
@Module({ providers: [CapabilityLifecycle], exports: [CapabilityLifecycle] })
export class CapabilityLifecycleModule {}
