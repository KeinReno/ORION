import type { ExtensionFetchInput, ExtensionFetchResult, ExtensionRecord, ExtensionSecretStatus } from "@orion/shared-types";
import { addPlace, type CommandPlace, type PanelPlace, type SettingsPlace, type WidgetPlace } from "../places";

/**
 * Жизненный цикл расширений из папки (ADR-0022, E2) — без React, чтобы проверять юнит-тестами.
 *
 * Расширение — ES-модуль с `activate(ctx)` (и необязательным `deactivate()`). Всё, что оно регистрирует через `ctx`,
 * помечается его id и снимается при выгрузке: выключили, удалили, поменяли код (режим разработчика) — места исчезают,
 * новый код загружается заново.
 */

type Omitted = "pluginId" | "runtime";

/**
 * Данные, секреты и сеть расширения (E3), уже привязанные к его id: чужие данные оно не видит, а сервер ещё раз
 * проверяет, что всё это объявлено в манифесте (`permissions.storage / secrets / network`).
 */
export interface ExtensionServices {
  storage: {
    list(workspaceId: string, collection: string): Promise<ExtensionRecord[]>;
    get(workspaceId: string, collection: string, key: string): Promise<ExtensionRecord | undefined>;
    put(workspaceId: string, collection: string, key: string, data: unknown): Promise<ExtensionRecord>;
    remove(workspaceId: string, collection: string, key: string): Promise<void>;
  };
  secrets: {
    /** Объявленные секреты и заданы ли они у пользователя (значение интерфейсу не отдаётся). */
    status(): Promise<ExtensionSecretStatus[]>;
    set(name: string, value: string): Promise<ExtensionSecretStatus>;
    clear(name: string): Promise<void>;
  };
  /** https-запрос к объявленному хосту через сервер; `{{secret:имя}}` в заголовках подставляет сервер. */
  fetch(workspaceId: string, input: ExtensionFetchInput): Promise<ExtensionFetchResult>;
}

export interface ExtensionContext extends ExtensionServices {
  /** id расширения из манифеста. */
  id: string;
  addPanel(place: Omit<PanelPlace, Omitted>): () => void;
  addWidget(place: Omit<WidgetPlace, Omitted>): () => void;
  addSettings(place: Omit<SettingsPlace, Omitted>): () => void;
  addCommand(place: Omit<CommandPlace, Omitted>): () => void;
  /** Что сделать при выгрузке (таймеры, подписки). */
  onDispose(dispose: () => void): void;
}

export interface ExtensionModule {
  activate?: (context: ExtensionContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export interface DesiredExtension {
  id: string;
  /** Адрес кода; смена адреса (новый хеш) = перезагрузка. */
  url: string;
}

export type ExtensionLoadState = { status: "loading" } | { status: "active" } | { status: "failed"; error: string };

interface Loaded {
  url: string;
  disposers: Array<() => void>;
  module: ExtensionModule | null;
}

export interface ExtensionRuntime {
  /** Приводит загруженное к желаемому: выгружает лишнее и изменившееся, загружает новое. */
  sync(desired: readonly DesiredExtension[]): Promise<void>;
  state(id: string): ExtensionLoadState | undefined;
  subscribe(listener: () => void): () => void;
  version(): number;
}

/** `importModule` — подмена для тестов; в браузере это настоящий `import(url)`. */
const NO_SERVICES = (): ExtensionServices => {
  const unavailable = (): Promise<never> => Promise.reject(new Error("Данные расширений недоступны в этом окне"));
  return { storage: { list: unavailable, get: unavailable, put: unavailable, remove: unavailable }, secrets: { status: unavailable, set: unavailable, clear: unavailable }, fetch: unavailable };
};

/**
 * `importModule` — подмена для тестов; в браузере это настоящий `import(url)`. `services(id)` — данные, секреты и сеть
 * для расширения `id` (в браузере — поверх ApiClient).
 */
export function createExtensionRuntime(
  importModule: (url: string) => Promise<ExtensionModule>,
  services: (extensionId: string) => ExtensionServices = NO_SERVICES
): ExtensionRuntime {
  const loaded = new Map<string, Loaded>();
  const states = new Map<string, ExtensionLoadState>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let queue = Promise.resolve();

  const changed = (): void => {
    revision += 1;
    for (const listener of listeners) listener();
  };
  const setState = (id: string, state: ExtensionLoadState | undefined): void => {
    if (state) states.set(id, state);
    else states.delete(id);
    changed();
  };

  async function unload(id: string): Promise<void> {
    const entry = loaded.get(id);
    if (!entry) return;
    loaded.delete(id);
    for (const dispose of entry.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(`[extensions] ${id}: ошибка при выгрузке`, error);
      }
    }
    try {
      await entry.module?.deactivate?.();
    } catch (error) {
      console.error(`[extensions] ${id}: deactivate упал`, error);
    }
  }

  async function load(target: DesiredExtension): Promise<void> {
    const entry: Loaded = { url: target.url, disposers: [], module: null };
    loaded.set(target.id, entry);
    setState(target.id, { status: "loading" });
    const track = (dispose: () => void): (() => void) => {
      entry.disposers.push(dispose);
      return dispose;
    };
    const context: ExtensionContext = {
      ...services(target.id),
      id: target.id,
      addPanel: (place) => track(addPlace("panel", { ...place, pluginId: target.id, runtime: true })),
      addWidget: (place) => track(addPlace("widget", { ...place, pluginId: target.id, runtime: true })),
      addSettings: (place) => track(addPlace("settings", { ...place, pluginId: target.id, runtime: true })),
      addCommand: (place) => track(addPlace("command", { ...place, pluginId: target.id, runtime: true })),
      onDispose: (dispose) => void track(dispose)
    };
    try {
      const module = await importModule(target.url);
      // Unloaded while the import was in flight: drop what activate would add.
      if (loaded.get(target.id) !== entry) return;
      entry.module = module;
      if (typeof module.activate !== "function") throw new Error("в модуле нет функции activate(ctx)");
      await module.activate(context);
      if (loaded.get(target.id) === entry) setState(target.id, { status: "active" });
    } catch (error) {
      for (const dispose of entry.disposers.splice(0).reverse()) dispose();
      if (loaded.get(target.id) === entry) setState(target.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      console.error(`[extensions] ${target.id}: не загрузилось`, error);
    }
  }

  return {
    sync(desired) {
      // One pass at a time: a slow import must not interleave with the next poll.
      queue = queue.then(async () => {
        const want = new Map(desired.map((item) => [item.id, item]));
        for (const [id, entry] of [...loaded]) {
          const target = want.get(id);
          if (!target || target.url !== entry.url) {
            await unload(id);
            if (!target) setState(id, undefined);
          }
        }
        for (const target of desired) if (!loaded.has(target.id)) await load(target);
      });
      return queue;
    },
    state: (id) => states.get(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => revision
  };
}
