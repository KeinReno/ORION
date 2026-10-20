import type { ExtensionFetchInput, ExtensionFetchResult, ExtensionRecord, ExtensionSecretStatus } from "@orion/shared-types";
import { ORION_MODULE_IDS, ORION_PLUGIN_IDS } from "@orion/shared-types";
import type { ComponentType } from "react";
import { CORE_SLOT_NAMES, type MetaOf, type SlotContracts, type SlotName } from "../contracts";
import { addPlace, type CommandPlace, type PanelPlace, type SettingsPlace, type WidgetPlace } from "../places";
import { contribute as contributeToRegistry } from "../registry";

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

/** Слот, который объявило расширение (E5): `<id расширения>.<имя>`; наполняют другие расширения через `ctx.contribute`. */
const EXTENSION_SLOT_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
const CORE_SLOTS = new Set<string>(CORE_SLOT_NAMES);
/** Пространства имён ядра: слот с таким префиксом, которого нет в CORE_SLOT_NAMES, — опечатка, а не слот расширения. */
const CORE_PREFIXES = new Set<string>([...ORION_MODULE_IDS, ...ORION_PLUGIN_IDS, "shell", "dashboard"]);

/** Вклад в слот: в слот ядра — с его типизированными пропсами, в слот расширения — с любыми. */
export interface SlotContribution<P> {
  component: ComponentType<P>;
  order?: number;
  meta?: unknown;
}

export interface ExtensionContext extends ExtensionServices {
  /** id расширения из манифеста. */
  id: string;
  addPanel(place: Omit<PanelPlace, Omitted>): () => void;
  addWidget(place: Omit<WidgetPlace, Omitted>): () => void;
  addSettings(place: Omit<SettingsPlace, Omitted>): () => void;
  addCommand(place: Omit<CommandPlace, Omitted>): () => void;
  /**
   * Вклад в слот (E5): слот ядра (`"habits.insights"`, `"finance.tabs"` с \`meta\`…) или слот другого расширения
   * (`"ai-tokens.provider-cards"`). Снимается сам при выгрузке; возвращает отмену.
   */
  contribute<S extends SlotName>(slot: S, contribution: { component: ComponentType<SlotContracts[S]>; order?: number; meta?: MetaOf<S> }): () => void;
  contribute(slot: string, contribution: SlotContribution<Record<string, unknown>>): () => void;
  /**
   * Свой слот (E5): компонент, который рисует вклады других расширений в `<id>.<name>`. Пропсы, переданные ему,
   * получит каждый вклад.
   */
  slot(name: string): ComponentType<Record<string, unknown>>;
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
/** Проверяет имя слота для `ctx.contribute`: слот ядра или корректно названный слот расширения. */
export function assertContributableSlot(slot: string): void {
  if (CORE_SLOTS.has(slot)) return;
  if (!EXTENSION_SLOT_RE.test(slot)) throw new Error(`Слот «${slot}»: ожидается слот ядра или «<id расширения>.<имя>»`);
  if (CORE_PREFIXES.has(slot.split(".")[0]!)) throw new Error(`Слота ядра «${slot}» нет — проверьте имя (список: CORE_SLOT_NAMES)`);
}

const NO_OUTLET = (): ComponentType<Record<string, unknown>> => () => null;

export function createExtensionRuntime(
  importModule: (url: string) => Promise<ExtensionModule>,
  services: (extensionId: string) => ExtensionServices = NO_SERVICES,
  /** Компонент, рисующий вклады слота расширения (в браузере — `ExtensionSlot` хоста). */
  outlet: (slot: string) => ComponentType<Record<string, unknown>> = NO_OUTLET
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
      // One implementation behind both overloads: the slot name is checked at run time, the props are the slot's business.
      contribute: ((slot: string, contribution: SlotContribution<never>) => {
        assertContributableSlot(slot);
        return track(
          contributeToRegistry(slot as SlotName, {
            pluginId: target.id,
            component: contribution.component as never,
            order: contribution.order,
            meta: contribution.meta as never,
            runtime: true
          })
        );
      }) as ExtensionContext["contribute"],
      slot: (name: string) => {
        const full = `${target.id}.${name}`;
        assertContributableSlot(full);
        return outlet(full);
      },
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
