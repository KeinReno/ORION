import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

/**
 * «Места», которые плагин или расширение ДОБАВЛЯЕТ в интерфейс (ADR-0022, E1), в отличие от слотов (`registry.ts`), куда
 * вклад вставляется в чужой экран: своя панель дока с пунктом меню, карточка дашборда, раздел настроек, команда Ctrl+K.
 *
 * Хранилище живёт во время выполнения: регистрация возвращает функцию отмены, а подписчики узнают об изменениях — так
 * расширение, загруженное после старта (E2), появляется без перезагрузки и исчезает при выключении. Включён ли владелец
 * места (`pluginId`) в пространстве, решает хост (`places-host.tsx`), не это хранилище.
 */

/** Что получает компонент панели расширения. */
export interface ExtensionPanelProps {
  workspaceId: string;
  /** Переименовать вкладку дока (по умолчанию — `label` места). */
  setTitle: (title: string) => void;
}

/** Что получают карточка дашборда и раздел настроек. */
export interface ExtensionPlaceProps {
  workspaceId: string;
}

interface PlaceBase {
  /** Владелец: плагин основной сборки или расширение. Место показывается, только пока владелец включён. */
  pluginId: string;
  /** Короткий id внутри владельца (kebab-case); глобальный id — `<pluginId>.<id>`. */
  id: string;
  /** Меньше — раньше. При равенстве — порядок регистрации. */
  order?: number;
  /**
   * Место расширения из папки (E2). Его владельца нет в каталоге плагинов: загрузчик регистрирует место только для
   * подтверждённого и включённого расширения и снимает его при выключении, так что «включён ли владелец» уже решено.
   */
  runtime?: boolean;
}

export interface PanelPlace extends PlaceBase {
  label: string;
  icon: LucideIcon;
  /** Группа меню; по умолчанию «Расширения». */
  group?: string;
  component: ComponentType<ExtensionPanelProps>;
}

export interface WidgetPlace extends PlaceBase {
  title: string;
  component: ComponentType<ExtensionPlaceProps>;
}

export interface SettingsPlace extends PlaceBase {
  label: string;
  component: ComponentType<ExtensionPlaceProps>;
}

export interface CommandPlace extends PlaceBase {
  label: string;
  icon?: LucideIcon;
  run: (context: { workspaceId: string | undefined }) => void | Promise<void>;
}

export interface PlaceKinds {
  panel: PanelPlace;
  widget: WidgetPlace;
  settings: SettingsPlace;
  command: CommandPlace;
}
export type PlaceKind = keyof PlaceKinds;

export const DEFAULT_PLACE_GROUP = "Расширения";

/** `<pluginId>.<id>` — уникален среди мест одного вида; он же instanceId панели `ext:<…>`. */
export function placeKey(place: PlaceBase): string {
  return `${place.pluginId}.${place.id}`;
}

const PLACE_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface PlacesStore {
  /** Добавляет место; возвращает отмену. Повтор того же `<pluginId>.<id>` игнорируется (первый остаётся), как в реестре слотов. */
  add<K extends PlaceKind>(kind: K, place: PlaceKinds[K]): () => void;
  /** Все места вида в порядке `order`, затем регистрации. */
  list<K extends PlaceKind>(kind: K): PlaceKinds[K][];
  find<K extends PlaceKind>(kind: K, key: string): PlaceKinds[K] | undefined;
  subscribe(listener: () => void): () => void;
  /** Растёт при каждом изменении — снимок для `useSyncExternalStore`. */
  version(): number;
}

export function createPlaces(): PlacesStore {
  const table: { [K in PlaceKind]: PlaceKinds[K][] } = { panel: [], widget: [], settings: [], command: [] };
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = (): void => {
    revision += 1;
    for (const listener of listeners) listener();
  };
  return {
    add(kind, place) {
      if (!PLACE_ID_RE.test(place.id)) throw new Error(`Место «${place.id}» плагина ${place.pluginId}: id в kebab-case`);
      const list = table[kind] as PlaceKinds[typeof kind][];
      const key = placeKey(place);
      if (list.some((item) => placeKey(item) === key)) return () => undefined;
      list.push(place);
      changed();
      return () => {
        const index = list.indexOf(place);
        if (index === -1) return;
        list.splice(index, 1);
        changed();
      };
    },
    list(kind) {
      return (table[kind] as PlaceKinds[typeof kind][])
        .map((place, index) => ({ place, index }))
        .sort((a, b) => (a.place.order ?? 0) - (b.place.order ?? 0) || a.index - b.index)
        .map(({ place }) => place);
    },
    find(kind, key) {
      return (table[kind] as PlaceKinds[typeof kind][]).find((place) => placeKey(place) === key);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => revision
  };
}

export const places: PlacesStore = createPlaces();

/** Регистрация места в общем хранилище (так её вызывает сгенерированный код и, позже, `ctx` расширения). */
export function addPlace<K extends PlaceKind>(kind: K, place: PlaceKinds[K]): () => void {
  return places.add(kind, place);
}
