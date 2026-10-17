import { LAN_REMOTE_PREFIX } from "@orion/shared-types";
import type { KeyValueStorage } from "@orion/core";

/**
 * ТЗ-04: окно ORION всегда говорит с ЛОКАЛЬНЫМ API по loopback. В режиме «Клиент LAN» путь запросов получает
 * префикс `/_remote`, и локальный API проксирует их на выбранный узел (пиннинг сертификата и device-токен — там).
 * Отметка режима лежит в localStorage окна: она нужна синхронно до первого запроса. Истина — файл узла на машине
 * (`GET /lan/client/status`), панель «Сеть» сверяет их и чинит расхождение.
 */
const KEY = "orion.node.v1";

export interface ClientNodeMark {
  mode: "client";
  nodeId: string;
  name: string;
}

export function readNodeMark(storage: Pick<Storage, "getItem"> | null = safeStorage()): ClientNodeMark | null {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? "null") as Partial<ClientNodeMark> | null;
    return parsed?.mode === "client" && parsed.nodeId ? { mode: "client", nodeId: parsed.nodeId, name: parsed.name ?? "Узел LAN" } : null;
  } catch {
    return null;
  }
}

export function writeNodeMark(mark: ClientNodeMark | null): void {
  try {
    const storage = safeStorage();
    if (!storage) return;
    if (mark) storage.setItem(KEY, JSON.stringify(mark));
    else storage.removeItem(KEY);
  } catch {
    // Хранилище недоступно — окно останется в «Локальном»: безопасный выбор по умолчанию.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Базовый адрес API окна: локальный, либо с префиксом прокси узла. */
export function applyNodeMode(localBase: string, mark: ClientNodeMark | null): string {
  return mark ? `${localBase}${LAN_REMOTE_PREFIX}` : localBase;
}

/**
 * Токены входа у каждого узла свои: сессия хоста не должна затирать локальную и наоборот. Для «Локального» пространство
 * имён пустое — существующие входы пользователей остаются на месте.
 */
export class NamespacedStorage implements KeyValueStorage {
  constructor(
    private readonly inner: KeyValueStorage,
    private readonly prefix: string
  ) {}
  get(key: string) {
    return this.inner.get(this.prefix + key);
  }
  set(key: string, value: string) {
    return this.inner.set(this.prefix + key, value);
  }
  remove(key: string) {
    return this.inner.remove(this.prefix + key);
  }
}

export function nodeStoragePrefix(mark: ClientNodeMark | null): string {
  return mark ? `node:${mark.nodeId}:` : "";
}
