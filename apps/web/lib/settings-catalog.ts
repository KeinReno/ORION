/**
 * What the settings panel contains, grouped by WHO a change affects — the one source for the
 * navigation, the scope line above each tab and the parameter search (settings panel and the
 * command palette). Tab values are persisted in detached views (`view:settings~<tab>`), so an
 * existing value is never renamed; a new tab gets a new value.
 */

export type SettingsTab =
  | "profile"
  | "security"
  | "notifications"
  | "appearance"
  | "themes"
  | "region"
  | "spheres"
  | "workspace"
  | "members"
  | "modules"
  | "plugins"
  | "agents"
  | "network"
  | "updates"
  | "extensions"
  | "about"
  | "diagnostics";

/** personal — the account, everywhere; workspace — everyone in the open workspace; agents — the viewer, only in this workspace; device — this installation. */
export type SettingsScope = "personal" | "workspace" | "workspace-personal" | "device" | "info";

export interface SettingsTabInfo {
  value: SettingsTab;
  label: string;
  scope: SettingsScope;
}

export interface SettingsGroup {
  id: "you" | "workspace" | "device" | "help";
  tabs: readonly SettingsTabInfo[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "you",
    tabs: [
      { value: "profile", label: "Профиль", scope: "personal" },
      { value: "security", label: "Безопасность", scope: "personal" },
      { value: "notifications", label: "Уведомления", scope: "personal" },
      { value: "appearance", label: "Внешний вид", scope: "personal" },
      { value: "themes", label: "Темы", scope: "personal" },
      { value: "region", label: "Дата и время", scope: "personal" },
      { value: "spheres", label: "Сферы и избранное", scope: "personal" }
    ]
  },
  {
    id: "workspace",
    tabs: [
      { value: "workspace", label: "Общее", scope: "workspace" },
      { value: "members", label: "Участники", scope: "workspace" },
      { value: "modules", label: "Модули", scope: "workspace" },
      { value: "plugins", label: "Плагины", scope: "workspace" },
      { value: "agents", label: "ИИ и агенты", scope: "workspace-personal" }
    ]
  },
  {
    id: "device",
    tabs: [
      { value: "network", label: "Сеть и устройства", scope: "device" },
      { value: "updates", label: "Обновления", scope: "device" },
      { value: "extensions", label: "Расширения", scope: "device" }
    ]
  },
  {
    id: "help",
    tabs: [
      { value: "about", label: "О приложении", scope: "info" },
      { value: "diagnostics", label: "Диагностика", scope: "info" }
    ]
  }
];

export const SETTINGS_TABS: readonly SettingsTabInfo[] = SETTINGS_GROUPS.flatMap((group) => group.tabs);

export function settingsTabInfo(tab: string | null | undefined): SettingsTabInfo | undefined {
  return SETTINGS_TABS.find((item) => item.value === tab);
}

export function isSettingsTab(tab: string | null | undefined): tab is SettingsTab {
  return settingsTabInfo(tab) !== undefined;
}

/** Group heading in the navigation; the workspace group names the workspace it changes. */
export function settingsGroupLabel(group: SettingsGroup["id"], workspaceName: string | undefined): string {
  switch (group) {
    case "you":
      return "Ваша учётная запись";
    case "workspace":
      return workspaceName ? `Пространство «${workspaceName}»` : "Пространство";
    case "device":
      return "Этот компьютер";
    case "help":
      return "Справка";
  }
}

/** The line above a tab's content: who sees the change. Null for informational tabs. */
export function settingsScopeText(scope: SettingsScope, workspaceName: string | undefined): string | null {
  const name = workspaceName ? `«${workspaceName}»` : "этого пространства";
  switch (scope) {
    case "personal":
      return "Только для вас — во всех ваших пространствах и на всех устройствах.";
    case "workspace":
      return `Для всех участников ${name}.`;
    case "workspace-personal":
      return `Только ваши агенты и только в пространстве ${name}.`;
    case "device":
      return "Только на этом компьютере.";
    case "info":
      return null;
  }
}

/**
 * One searchable parameter. `anchor` is the `data-setting` attribute of the field in the tab;
 * a parameter without its own anchor lands on the top of the tab.
 */
export interface SettingsField {
  anchor: string;
  tab: SettingsTab;
  label: string;
  keywords?: string;
}

export const SETTINGS_FIELDS: readonly SettingsField[] = [
  { anchor: "avatar", tab: "profile", label: "Фото профиля", keywords: "аватар картинка" },
  { anchor: "name", tab: "profile", label: "Имя", keywords: "профиль" },
  { anchor: "email", tab: "profile", label: "Email", keywords: "почта адрес" },
  { anchor: "password", tab: "security", label: "Пароль или PIN", keywords: "вход сменить пин" },
  { anchor: "sessions", tab: "security", label: "Устройства и сессии", keywords: "выйти везде завершить сессию" },
  { anchor: "desktop-notifications", tab: "notifications", label: "Уведомления на рабочем столе", keywords: "тосты windows" },
  { anchor: "task-reminders", tab: "notifications", label: "Напоминания о задачах", keywords: "просрочено срок telegram" },
  { anchor: "event-reminders", tab: "notifications", label: "Напоминания о событиях", keywords: "календарь" },
  { anchor: "finance-alerts", tab: "notifications", label: "Предупреждения о финансах", keywords: "бюджет превышение" },
  { anchor: "inventory-alerts", tab: "notifications", label: "Низкий остаток на складе", keywords: "запас порог склад" },
  { anchor: "quiet-hours", tab: "notifications", label: "Тихие часы", keywords: "не беспокоить ночь" },
  { anchor: "shell", tab: "appearance", label: "Оформление Orion", keywords: "kaiden precision прежний интерфейс оболочка" },
  { anchor: "accent", tab: "appearance", label: "Акцент", keywords: "цвет" },
  { anchor: "density", tab: "appearance", label: "Плотность", keywords: "компактная свободная размер шрифта" },
  { anchor: "menu-position", tab: "appearance", label: "Положение меню", keywords: "сайдбар слева справа сверху снизу" },
  { anchor: "tabs-mode", tab: "appearance", label: "Вкладки сверху", keywords: "копить заменять" },
  { anchor: "background", tab: "appearance", label: "Фон", keywords: "аврора сетка эфир волны" },
  { anchor: "surfaces", tab: "appearance", label: "Поверхности", keywords: "стекло прозрачность блюр цвет панелей" },
  { anchor: "note-ids", tab: "appearance", label: "Номера заметок", keywords: "n-104 идентификатор" },
  { anchor: "motion", tab: "appearance", label: "Анимации", keywords: "движение эффекты пружина уменьшить" },
  { anchor: "target-cursor", tab: "appearance", label: "Курсор-цель", keywords: "рамка мышь" },
  { anchor: "theme-library", tab: "themes", label: "Библиотека тем", keywords: "палитра цвета своя тема" },
  { anchor: "workspace-theme", tab: "themes", label: "Тема пространства", keywords: "для всех участников" },
  { anchor: "time-zone", tab: "region", label: "Часовой пояс", keywords: "время зона utc" },
  { anchor: "week-start", tab: "region", label: "Начало недели", keywords: "понедельник воскресенье календарь" },
  { anchor: "spheres", tab: "spheres", label: "Сферы", keywords: "группы пространств" },
  { anchor: "favorites", tab: "spheres", label: "Избранные пространства", keywords: "звезда" },
  { anchor: "rename", tab: "workspace", label: "Название пространства", keywords: "переименовать" },
  { anchor: "delete", tab: "workspace", label: "Удалить пространство" },
  { anchor: "members", tab: "members", label: "Участники пространства", keywords: "роли владелец тимлид" },
  { anchor: "invite", tab: "members", label: "Пригласить участника", keywords: "приглашение email ссылка" },
  { anchor: "modules", tab: "modules", label: "Модули пространства", keywords: "включить выключить скрыть разделы" },
  { anchor: "plugins", tab: "plugins", label: "Плагины", keywords: "расширения включить выключить" },
  { anchor: "agents", tab: "agents", label: "ИИ и агенты", keywords: "токен mcp ai bridge доступ ассистент ключ модель claude подписка подключить" },
  { anchor: "network", tab: "network", label: "Сеть и устройства", keywords: "lan хост подключение локальный" },
  { anchor: "updates", tab: "updates", label: "Обновления", keywords: "версия github токен установить" },
  { anchor: "extensions-folder", tab: "extensions", label: "Папка расширений", keywords: "плагины установить добавить подтвердить режим разработчика" },
  { anchor: "app-info", tab: "about", label: "Версия приложения", keywords: "о программе" },
  { anchor: "onboarding", tab: "about", label: "Подсказка первого запуска", keywords: "знакомство обучение помощь" },
  { anchor: "components", tab: "diagnostics", label: "Диагностика компонентов", keywords: "миграции модули ошибки" },
  { anchor: "api-health", tab: "diagnostics", label: "Состояние API", keywords: "сервер база проверить" }
];

export interface SettingsSearchHit {
  anchor: string | null;
  tab: SettingsTab;
  label: string;
  /** Where the hit lives, for the result line: «Уведомления». */
  tabLabel: string;
}

const normalize = (text: string): string => text.toLocaleLowerCase("ru").replace(/ё/g, "е");

/**
 * Every query word has to occur in the label, the keywords or the tab name; a label that starts
 * with the query ranks first, then one that contains it, then keyword-only matches. Tabs match too
 * (anchor null), so «уведомления» finds the whole tab.
 */
export function searchSettings(query: string, limit = 12): SettingsSearchHit[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const phrase = words.join(" ");
  const candidates: (SettingsSearchHit & { rank: number })[] = [];
  const consider = (hit: SettingsSearchHit, keywords: string): void => {
    const label = normalize(hit.label);
    const haystack = `${label} ${normalize(keywords)} ${normalize(hit.tabLabel)}`;
    if (!words.every((word) => haystack.includes(word))) return;
    const rank = label.startsWith(phrase) ? 0 : label.includes(phrase) ? 1 : 2;
    candidates.push({ ...hit, rank });
  };
  for (const field of SETTINGS_FIELDS) {
    const tabLabel = settingsTabInfo(field.tab)?.label ?? field.tab;
    consider({ anchor: field.anchor, tab: field.tab, label: field.label, tabLabel }, field.keywords ?? "");
  }
  for (const tab of SETTINGS_TABS) consider({ anchor: null, tab: tab.value, label: tab.label, tabLabel: tab.label }, "");
  // A field named exactly like its tab («Плагины») would show twice: keep the field (listed first), it scrolls further.
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => a.rank - b.rank)
    .filter((hit) => {
      const key = `${hit.tab}:${normalize(hit.label)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((hit) => ({ anchor: hit.anchor, tab: hit.tab, label: hit.label, tabLabel: hit.tabLabel }))
    .slice(0, limit);
}
