import {
  isModuleEnabled,
  isOrionModuleId,
  isPluginEnabled,
  isOrionPluginId,
  PLUGIN_CATALOG,
  type DomainEventType
} from "@orion/shared-types";

/** Сколько раз пробуем доставить событие подписчику, прежде чем пометить доставку `failed`. */
export const MAX_DELIVERY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** Пауза перед следующей попыткой после `attempts`-й неудачи (1-я неудача → 30 с, далее ×2, потолок час). */
export function backoffMs(attempts: number): number {
  const exp = Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exp);
}

export function nextAttemptAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + backoffMs(attempts));
}

/** Статус доставки после неудачной попытки номер `attempts`. */
export function statusAfterFailure(attempts: number): "pending" | "failed" {
  return attempts >= MAX_DELIVERY_ATTEMPTS ? "failed" : "pending";
}

export interface SubscriberLike {
  id: string;
  componentId: string;
  types: readonly DomainEventType[];
}

/** Подписчики, которым нужно событие данного типа (порядок регистрации сохраняется). */
export function subscribersFor<T extends SubscriberLike>(subscribers: Iterable<T>, type: string): T[] {
  return [...subscribers].filter((s) => (s.types as readonly string[]).includes(type));
}

export interface WorkspaceCapabilityState {
  disabledModules: readonly string[];
  pluginOverrides: readonly string[];
}

/**
 * Включён ли компонент-владелец подписчика в пространстве. Модуль — не в `disabledModules`; плагин — включён по
 * `pluginOverrides` И включён его модуль-хозяин (как `pluginStates`). Неизвестный id считается выключенным.
 */
export function isComponentEnabled(componentId: string, ws: WorkspaceCapabilityState): boolean {
  // `core` is platform infrastructure, not a switchable module: always enabled.
  if (componentId === "core") return true;
  if (isOrionModuleId(componentId)) return isModuleEnabled(ws.disabledModules, componentId);
  if (isOrionPluginId(componentId)) {
    const host = PLUGIN_CATALOG.find((p) => p.id === componentId)?.extendsModuleId;
    return isPluginEnabled(ws.pluginOverrides, componentId) && !!host && isModuleEnabled(ws.disabledModules, host);
  }
  return false;
}
