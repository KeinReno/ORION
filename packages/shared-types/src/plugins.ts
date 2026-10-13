import { z } from "zod";
import { orionModuleIdSchema, type OrionModuleId } from "./modules";

/**
 * Plugins extend exactly one existing domain module — never the base shell
 * (dashboard/inbox/search/settings/sync). This is deliberately NOT a runtime
 * for loading arbitrary/external code: docs/HISTORY.md rejected a real Plugin
 * Runtime twice (v0.20, v0.23) as premature. A plugin here is a compiled-in
 * unit at the same trust level as a module, registered the same way
 * (PLUGIN_CATALOG mirrors MODULE_CATALOG) — the only extra rule is
 * `extendsModuleId` and auto-disable when that module is off.
 */
export const ORION_PLUGIN_IDS = [
  "team",
  "habits-insights",
  "finance-budgeting",
  "finance-goals",
  "finance-recurring",
  "finance-reports",
  "tasks-saved-views",
  "documents-history",
  "documents-office",
  "notes-history",
  "time-insights",
  "time-billing",
  "calendar-external",
  "tasks-comments",
  "tasks-kanban",
  "notes-daily",
  "notes-templates",
  "tasks-recurrence",
  "tasks-planning",
  "projects-planning",
  "projects-ideas",
  "projects-problems",
  "inventory-alerts",
  "calendar-recurrence",
  "calendar-reminders",
  "finance-quick-entry",
  "finance-import",
  "finance-obligations",
  "finance-forecast",
  "inventory-costing"
] as const;

export const orionPluginIdSchema = z.enum(ORION_PLUGIN_IDS);
export type OrionPluginId = z.infer<typeof orionPluginIdSchema>;

export const pluginManifestSchema = z.object({
  id: orionPluginIdSchema,
  /** The one module this plugin extends. */
  extendsModuleId: orionModuleIdSchema,
  label: z.string(),
  summary: z.string(),
  provides: z.array(z.string()),
  disableBehavior: z.string(),
  defaultEnabled: z.boolean()
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const workspacePluginStateSchema = pluginManifestSchema.extend({
  enabled: z.boolean()
});
export type WorkspacePluginState = z.infer<typeof workspacePluginStateSchema>;

export const setWorkspacePluginInputSchema = z.object({
  enabled: z.boolean()
});
export type SetWorkspacePluginInput = z.infer<typeof setWorkspacePluginInputSchema>;

export function isOrionPluginId(value: string): value is OrionPluginId {
  return (ORION_PLUGIN_IDS as readonly string[]).includes(value);
}

/**
 * `pluginOverrides` holds ids whose enabled state was flipped away from the
 * manifest's `defaultEnabled` — unlike modules (all `defaultEnabled: true`,
 * so "disabled list" and "overrides" coincide), a plugin can default off, so
 * "empty list = everything on" would be wrong here. An id present in the
 * list means "not at default"; absent means "at default".
 */
export function isPluginEnabled(pluginOverrides: readonly string[] | null | undefined, id: OrionPluginId): boolean {
  const manifest = PLUGIN_CATALOG.find((item) => item.id === id);
  if (!manifest) return false;
  const overridden = (pluginOverrides ?? []).includes(id);
  return overridden ? !manifest.defaultEnabled : manifest.defaultEnabled;
}

/**
 * A plugin whose host module is disabled is always reported disabled here,
 * regardless of `pluginOverrides` — auto-disable, not a separate flag to
 * keep in sync.
 */
export function pluginStates(
  pluginOverrides: readonly string[] | null | undefined,
  enabledModuleIds: ReadonlySet<OrionModuleId>
): WorkspacePluginState[] {
  return PLUGIN_CATALOG.map((manifest) => ({
    ...manifest,
    enabled: isPluginEnabled(pluginOverrides, manifest.id) && enabledModuleIds.has(manifest.extendsModuleId)
  }));
}

/** Compiled-in catalog — same posture as MODULE_CATALOG, now two plugins: the original optional `team` and the first extraction, `habits-insights`. */
export const PLUGIN_CATALOG: readonly PluginManifest[] = [
  {
    id: "team",
    extendsModuleId: "tasks",
    label: "Команда",
    summary: "Назначение задач участникам, роль «тимлид» и фильтр «Мои задачи».",
    provides: ["Assignee у задачи", "Фильтр «Мои задачи»", "Роль «Тимлид»"],
    disableBehavior: "Назначение скрывается из интерфейса и не проверяется API; уже расставленные исполнители сохраняются.",
    defaultEnabled: false
  },
  {
    id: "habits-insights",
    extendsModuleId: "habits",
    label: "Аналитика привычек",
    summary: "Неделя по каждой привычке и 12-недельная карта активности рядом с ежедневным списком.",
    provides: ["Блок «Неделя»", "Блок «Активность» (12 недель)", "Отметка любого дня недели"],
    disableBehavior:
      "Блоки «Неделя» и «Активность» скрываются; отметки, серии и список «Сегодня» работают как прежде, данные не удаляются.",
    // Extracted from the base panel without changing what anyone sees: on by default.
    defaultEnabled: true
  },
  {
    id: "finance-budgeting",
    extendsModuleId: "finance",
    label: "Бюджеты",
    summary: "Месячные лимиты по категориям расходов и контроль «потрачено из лимита».",
    provides: ["Вкладка «Бюджеты»", "Лимит на месяц по категории"],
    disableBehavior: "Вкладка «Бюджеты» скрывается; лимиты сохраняются и вернутся при повторном включении.",
    defaultEnabled: true
  },
  {
    id: "finance-goals",
    extendsModuleId: "finance",
    label: "Цели накоплений",
    summary: "Цели с суммой и сроком, привязанные к счёту, и прогресс к ним.",
    provides: ["Вкладка «Цели»", "Прогресс накоплений по счёту"],
    disableBehavior: "Вкладка «Цели» скрывается; цели сохраняются.",
    defaultEnabled: true
  },
  {
    id: "finance-recurring",
    extendsModuleId: "finance",
    label: "Повторяющиеся платежи",
    summary: "Правила регулярных платежей и доходов, которые создают операции по расписанию.",
    provides: ["Вкладка «Повторяющиеся»", "Правила платежей"],
    disableBehavior:
      "Вкладка «Повторяющиеся» скрывается (правила нельзя смотреть и править); уже созданные операции остаются, а фоновое создание по расписанию на сервере продолжается — правила не удаляются.",
    defaultEnabled: true
  },
  {
    id: "finance-reports",
    extendsModuleId: "finance",
    label: "Отчёты по финансам",
    summary: "Доходы и расходы по месяцам, чистый капитал, расходы по категориям.",
    provides: ["Вкладка «Отчёты»", "Графики по месяцам и категориям"],
    disableBehavior: "Вкладка «Отчёты» скрывается; данные не затрагиваются.",
    defaultEnabled: true
  },
  {
    id: "tasks-saved-views",
    extendsModuleId: "tasks",
    label: "Сохранённые виды задач",
    summary: "Именованные наборы фильтров (поиск, проект) одним нажатием в шапке панели задач.",
    provides: ["Полоса видов в шапке «Задач»", "Кнопка «Сохранить вид»"],
    disableBehavior: "Полоса видов скрывается; сохранённые виды остаются и вернутся при повторном включении.",
    defaultEnabled: true
  },
  {
    id: "documents-history",
    extendsModuleId: "documents",
    label: "История версий файлов",
    summary: "Список прежних версий файла с загрузкой и восстановлением.",
    provides: ["Пункт «История версий…» в меню файла", "Восстановление прежней версии"],
    disableBehavior:
      "Пункт меню и окно истории скрываются; версии продолжают сохраняться при замене содержимого, поэтому история будет на месте при повторном включении.",
    defaultEnabled: true
  },
  {
    id: "documents-office",
    extendsModuleId: "documents",
    label: "Редакторы документов и таблиц",
    summary: "Создание и правка файлов Word (DOCX) и Excel (XLSX) прямо в приложении.",
    provides: ["Кнопки «Документ» и «Таблица»", "Редактор DOCX и XLSX при открытии файла"],
    disableBehavior:
      "Кнопки создания скрываются, а DOCX и XLSX открываются обычным просмотром без правки; файлы не затрагиваются.",
    defaultEnabled: true
  },
  {
    id: "notes-history",
    extendsModuleId: "notes",
    label: "История версий заметок",
    summary: "Прежние версии заметки, отличия от текущей и откат.",
    provides: ["Кнопка «История версий» в редакторе заметки", "Сравнение и восстановление версии"],
    disableBehavior:
      "Кнопка и окно истории скрываются; версии продолжают сохраняться на сервере при правках, поэтому история будет на месте при повторном включении.",
    defaultEnabled: true
  },
  {
    id: "time-insights",
    extendsModuleId: "time",
    label: "Итоги и динамика времени",
    summary: "Часы за сегодня, 7 дней и всё время, разрез «мои / команда», время по проектам и графики динамики.",
    provides: ["Блок «Итоги»", "Блок «Динамика»"],
    disableBehavior: "Блоки скрываются; остаются таймер и журнал записей, данные не затрагиваются.",
    defaultEnabled: true
  },
  {
    id: "time-billing",
    extendsModuleId: "time",
    label: "Стоимость времени",
    summary: "Перевод часов в деньги по ставке проекта: итоговая стоимость, по проектам и у каждой записи.",
    provides: ["Строки «Стоимость времени»", "Стоимость у записей и проектов"],
    disableBehavior: "Деньги нигде не показываются; ставки проектов и записи времени сохраняются.",
    defaultEnabled: true
  },
  {
    id: "calendar-external",
    extendsModuleId: "calendar",
    label: "Внешние календари",
    summary: "Подписка на чужие ICS-календари (только чтение) и ссылка на экспорт календаря ORION.",
    provides: ["Кнопка «Ссылка» в шапке календаря", "Подписки на ICS и ссылка-фид"],
    disableBehavior:
      "Кнопка скрывается, управлять подписками и ссылкой нельзя. Уже загруженные внешние события остаются в календаре, фоновая синхронизация подписок на сервере продолжается; подписки не удаляются.",
    defaultEnabled: true
  },
  {
    id: "tasks-comments",
    extendsModuleId: "tasks",
    label: "Комментарии к задачам",
    summary: "Обсуждение задачи: комментарии с Markdown, правка и удаление своих, уведомление исполнителю.",
    provides: ["Вкладка «Комментарии» в карточке задачи", "Уведомление исполнителю о новом комментарии"],
    disableBehavior: "Вкладка скрывается; комментарии сохраняются и вернутся при повторном включении.",
    defaultEnabled: true
  },
  {
    id: "tasks-kanban",
    extendsModuleId: "tasks",
    label: "Доска задач",
    summary: "Вид «Доска»: колонки рядом, перетаскивание карточек между колонками.",
    provides: ["Переключатель «Доска» в панели задач"],
    disableBehavior: "Остаётся вид «Список»; статусы и задачи не меняются.",
    defaultEnabled: true
  },
  {
    id: "notes-daily",
    extendsModuleId: "notes",
    label: "Ежедневные заметки",
    summary: "Кнопка «Сегодня»: открывает или создаёт заметку на сегодняшний день.",
    provides: ["Кнопка «Сегодня» в шапке заметок"],
    disableBehavior: "Кнопка скрывается; уже созданные ежедневные заметки остаются обычными заметками.",
    defaultEnabled: true
  },
  {
    id: "notes-templates",
    extendsModuleId: "notes",
    label: "Шаблоны заметок",
    summary: "Заметки-шаблоны: отдельный список «Шаблоны», создание заметки из шаблона, команда «Сделать шаблоном».",
    provides: ["Фильтр «Шаблоны»", "Кнопка «Из шаблона»", "Команда «Сделать шаблоном»"],
    disableBehavior: "Фильтр, кнопка и команда скрываются; шаблоны остаются обычными заметками с пометкой и вернутся при повторном включении.",
    defaultEnabled: true
  },
  {
    id: "tasks-recurrence",
    extendsModuleId: "tasks",
    label: "Повторяющиеся задачи",
    summary: "Поля «Повтор» и «Каждые N» в задаче и значок повтора на карточке.",
    provides: ["Поля повтора в форме и карточке задачи", "Значок повтора на карточке"],
    disableBehavior:
      "Поля и значок скрываются, правило повтора нельзя менять; уже заданные правила сохраняются, и сервер по-прежнему создаёт следующую копию при завершении такой задачи.",
    defaultEnabled: true
  },
  {
    id: "tasks-planning",
    extendsModuleId: "tasks",
    label: "Планирование задач",
    summary: "Подзадачи, зависимости между задачами, плановое начало, оценка в часах и ручной порядок карточек.",
    provides: ["Секция «Подзадачи»", "Поля начала, оценки, родителя и зависимостей", "Значки «3/5» и «заблокирована»", "Вверх / вниз и перетаскивание порядка"],
    disableBehavior:
      "Поля, секция, значки и ручной порядок скрываются; подзадачи, зависимости, даты и порядок хранятся и вернутся при повторном включении (сервер по-прежнему считает «заблокирована»).",
    defaultEnabled: true
  },
  {
    id: "projects-planning",
    extendsModuleId: "projects",
    label: "План проекта",
    summary: "Вехи и план проекта: таймлайн, дорожная карта, календарь и диаграмма Ганта, лента вех в обзоре.",
    provides: ["Вкладка «План» в проекте", "Блок «План» в обзоре", "Панель и окно «План проекта»"],
    disableBehavior:
      "Вкладка, блок в обзоре и панель плана скрываются (открытая панель плана закрывается); вехи и даты задач сохраняются и вернутся при повторном включении.",
    defaultEnabled: true
  },
  {
    id: "projects-ideas",
    extendsModuleId: "projects",
    label: "Идеи",
    summary: "Короткие мысли, закреплённые за проектом: новая фича, направление, то, что не хочется забыть. Из идеи можно сделать задачу этого проекта.",
    provides: ["Вкладка «Идеи» в проекте", "Кнопка «Сделать задачей»"],
    disableBehavior: "Вкладка «Идеи» скрывается; записанные идеи сохраняются и вернутся при повторном включении. Уже созданные из них задачи остаются задачами.",
    defaultEnabled: true
  },
  {
    id: "projects-problems",
    extendsModuleId: "projects",
    label: "Проблемы",
    summary: "То, что не нравится в проекте, найденные баги и то, что нужно поправить — рядом с проектом, пока из записи не сделана задача.",
    provides: ["Вкладка «Проблемы» в проекте", "Пометки «Не нравится», «Баг», «Поправить»", "Кнопка «Сделать задачей»"],
    disableBehavior: "Вкладка «Проблемы» скрывается; записи сохраняются. Уже созданные из них задачи остаются задачами.",
    defaultEnabled: true
  },
  {
    id: "inventory-alerts",
    extendsModuleId: "inventory",
    label: "Низкий остаток",
    summary: "Порог остатка по позиции, карточка «Низкий остаток», значок на позиции и подсказка «ниже порога».",
    provides: ["Поле «Порог низкого остатка»", "Карточка и значок «низкий остаток»"],
    disableBehavior:
      "Поле порога, карточка и значки скрываются; пороги сохраняются, а уведомление о низком остатке на сервере продолжает приходить по ним (его отключают в настройках уведомлений).",
    defaultEnabled: true
  },
  {
    id: "calendar-recurrence",
    extendsModuleId: "calendar",
    label: "Повторяющиеся события",
    summary: "Раздел «Повтор» в форме события: ежедневно, по дням недели, ежемесячно, ежегодно, до даты или N раз.",
    provides: ["Раздел «Повтор» в форме события"],
    disableBehavior:
      "Раздел скрывается и правило нельзя менять; уже созданные повторяющиеся события остаются и показываются в календаре по своему правилу.",
    defaultEnabled: true
  },
  {
    id: "calendar-reminders",
    extendsModuleId: "calendar",
    label: "Напоминания о событиях",
    summary: "Раздел «Напоминания» в форме события: уведомление за N минут до начала.",
    provides: ["Раздел «Напоминания» в форме события"],
    disableBehavior:
      "Раздел скрывается и напоминания нельзя менять; заданные ранее напоминания продолжают приходить (их отключают в настройках уведомлений).",
    defaultEnabled: true
  },
  {
    id: "finance-quick-entry",
    extendsModuleId: "finance",
    label: "Быстрая запись операций",
    summary: "Строка над операциями: «-500 хлеб #еда @вчера» → черновик, который вы подтверждаете (счёт, расход/доход, категория).",
    provides: ["Строка быстрой записи в «Транзакциях»"],
    disableBehavior: "Строка скрывается; записанные операции остаются.",
    defaultEnabled: true
  },
  {
    id: "finance-import",
    extendsModuleId: "finance",
    label: "Импорт операций из CSV",
    summary: "Загрузка банковской выписки или выгрузки FinControl в выбранный счёт: проверка без записи, пропуск повторов, отчёт об ошибках.",
    provides: ["Вкладка «Импорт»"],
    disableBehavior: "Вкладка скрывается; уже импортированные операции остаются, повторный импорт того же файла по-прежнему не дублирует их.",
    defaultEnabled: true
  },
  {
    id: "finance-obligations",
    extendsModuleId: "finance",
    label: "Обязательства",
    summary: "Долги, кредиты, коммунальные платежи и подписки: план платежей и кнопка «Оплатить», которая записывает настоящую операцию.",
    provides: ["Вкладка «Обязательства»", "Оплата с записью операции и переносом срока"],
    disableBehavior:
      "Вкладка скрывается; обязательства и уже записанные платежи остаются (платёж — обычная операция). План сам баланс не меняет.",
    defaultEnabled: true
  },
  {
    id: "finance-forecast",
    extendsModuleId: "finance",
    label: "Прогноз остатка",
    summary: "Куда идёт остаток: средний месяц вашей истории, коридор от худшего до лучшего и плановые платежи отдельно — с описанием метода.",
    provides: ["Вкладка «Прогноз»"],
    disableBehavior: "Вкладка скрывается; данные не затрагиваются.",
    defaultEnabled: true
  },
  {
    id: "inventory-costing",
    extendsModuleId: "inventory",
    label: "Себестоимость склада",
    summary: "Цена прихода и средняя себестоимость позиции — в карточке и в окне позиции.",
    provides: ["Поле «Цена за единицу» у прихода", "Средняя себестоимость"],
    disableBehavior: "Поле цены и средняя себестоимость скрываются; остатки и движения не затрагиваются, прежние цены приходов сохраняются.",
    defaultEnabled: true
  }
];
