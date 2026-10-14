import type { ApiClient } from "@orion/core";
import type { DocumentItem, Habit, InventoryItem, ListItem, Milestone, Note, OrionModuleId, Project, RecurrenceSpec, Task, TaskPriority, TaskRecurrence, TaskStatus, TaskViewFilters, TimeEntry } from "@orion/shared-types";
import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import type { TimeProjectTotal, TimeSummary } from "../time-summary";

/**
 * The typed contract of every extension slot: exactly the props a host module hands to
 * whatever plugin fills the slot. These types are the whole public surface between a
 * module and its plugins — a plugin may not reach into the module's files, and a module
 * may not know a plugin's. Changing a contract is an architectural decision (an
 * Extension Proposal), not an edit made while building a feature.
 */

/** habits.insights — history-oriented blocks next to the daily checklist (week grid, activity map). */
export interface HabitsInsightsSlotProps {
  workspaceId: string | undefined;
  /** The workspace's non-archived habits, with the server's per-day fields. */
  habits: Habit[];
  /** Open the host's own edit UI for a habit — the host owns editing, the plugin only asks. */
  onEditHabit: (habit: Habit) => void;
  /** Archive through the host (it also owns the undo toast). */
  onArchiveHabit: (habit: Habit) => void;
}

/** habits.detail — the same history, narrowed to ONE habit, inside the host's edit sheet. */
export interface HabitDetailSlotProps {
  workspaceId: string | undefined;
  habit: Habit;
  onArchiveHabit: (habit: Habit) => void;
}

/** finance.tabs — a tab of the Finance panel. The host draws the tab strip from each contribution's `meta`. */
export interface FinanceTabSlotProps {
  workspaceId: string | undefined;
}

/** tasks.views.bar — named filter presets in the Tasks panel header. The host owns the filters; the plugin saves and re-applies them. */
export interface TaskViewCriteria {
  search: string;
  projectId: string | null;
  due: NonNullable<TaskViewFilters["due"]>;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
}

export interface TasksViewsBarSlotProps {
  workspaceId: string | undefined;
  projects: Project[];
  /** The filters the panel currently has. */
  current: TaskViewCriteria;
  /** Display-only team scope; saved views do not silently change this host preference. */
  onlyMine?: boolean;
  /** Ask the host to take these filters. */
  onApply: (criteria: TaskViewCriteria) => void;
}

/**
 * documents.history — a dialog the host opens for one file. The host adds the menu entry
 * (label from `meta`) and keeps `doc` (null = closed); the plugin draws the dialog itself.
 */
export interface DocumentsHistorySlotProps {
  workspaceId: string | undefined;
  doc: DocumentItem | null;
  onClose: () => void;
}

/**
 * documents.editor — an in-app editor for some kinds of files. The contribution's `meta.handles`
 * tells the host which documents it opens; for those the host renders it instead of the plain
 * viewer, and `fallback` is what to show if the editor cannot open the file.
 */
export interface DocumentsEditorSlotProps {
  workspaceId: string;
  doc: DocumentItem;
  fallback: ReactNode;
  /** Tell the host whether leaving this file would discard editor changes. */
  onDirtyChange: (dirty: boolean) => void;
}

/** documents.create — contributes "new file" actions; it draws nothing, the host owns upload and selection. */
export type DocumentsCreateSlotProps = Record<string, never>;

export interface DocumentCreateAction {
  id: string;
  /** Label in the compact "Добавить" menu, e.g. «Новый документ». */
  menuLabel: string;
  /** Label on the toolbar button, e.g. «Документ». */
  buttonLabel: string;
  icon: ComponentType<{ className?: string }>;
  successTitle: string;
  /** Builds the empty file; the host uploads it into the current folder. */
  createFile: () => Promise<File>;
}

/**
 * notes.history — the version-history dialog of one note. The host shows a button when a plugin
 * fills the slot (label from `meta.buttonLabel`) and keeps `open`; the plugin draws the dialog.
 */
export interface NotesHistorySlotProps {
  workspaceId: string | undefined;
  noteId: string;
  /** The text in the editor right now (maybe unsaved) — the history diffs against it. */
  currentTitle: string;
  currentBody: string;
  open: boolean;
  onClose: () => void;
  /** A past version was restored: the host reloads the note. */
  onRestored: () => void;
}

/**
 * time.billing — money for tracked time. A plugin fills it with the presentational pieces the host
 * and the insights block use when they show a cost; it draws nothing by itself (the contribution's
 * component is a placeholder, the substance is `meta.api`). Without it no money is shown anywhere.
 */
export interface TimeBillingApi {
  /** Cost lines under the totals, or the «not priced» note. */
  SummaryCosts: ComponentType<{ summary: TimeSummary; ratesKnown: boolean; projectsOn: boolean }>;
  /** The «*» next to a project name when part of its time has no rate. */
  ProjectMark: ComponentType<{ item: TimeProjectTotal; summary: TimeSummary }>;
  /** The cost (or «—») at the end of a per-project row. */
  ProjectCost: ComponentType<{ item: TimeProjectTotal; ratesKnown: boolean }>;
  /** What a log row shows as its cost; null = nothing. */
  entryCost: (entry: TimeEntry, projects: Project[], now: Date) => { text: string; title?: string; partial?: boolean } | null;
}

export type TimeBillingSlotProps = Record<string, never>;

/** time.insights — the «Итоги» block and the «Динамика» charts of the Time panel. */
export interface TimeInsightsSlotProps {
  workspaceId: string | undefined;
  /** Active and archived projects (rates and names live there). */
  allProjects: Project[];
  projectNames: Map<string, string>;
  /** The loaded log — breakdowns are computed from it. */
  entries: TimeEntry[];
  summary: TimeSummary;
  /** False until the projects have loaded — until then no money and no «rate missing» is shown. */
  ratesKnown: boolean;
  projectsOn: boolean;
  /** Exact server-side totals in minutes (undefined while loading). */
  headline: { today: number | undefined; week: number | undefined; total: number | undefined };
  /** The money pieces, only when a billing plugin is on. */
  billing: TimeBillingApi | null;
}

/** calendar.toolbar — extra controls at the end of the source-chip row (the filter chips of the Calendar header). */
export interface CalendarToolbarSlotProps {
  workspaceId: string | undefined;
}

/**
 * tasks.detail.tabs — a tab in the lower part of the task detail pane (next to the built-in
 * «История» and «Связи»). The host draws the tab strip from each contribution's `meta`.
 */
export interface TaskDetailTabSlotProps {
  workspaceId: string | undefined;
  taskId: string;
}

/**
 * tasks.views — an extra way to lay out the task columns. Draws nothing itself (the contribution's
 * component is a placeholder): the host keeps the columns and drag-and-drop and asks the view only
 * for its label and the layout classes of the column container.
 */
export type TasksViewSlotProps = Record<string, never>;

export interface TasksViewMeta {
  viewId: string;
  label: string;
  /** Tailwind classes of the element that holds the columns, for `columnCount` columns. */
  layoutClass: (columnCount: number) => string;
  /** Layout of one column in this view (the host's own list view uses full width). */
  columnClass?: string;
}

/** notes.header.actions — extra buttons in the Notes header, before «Новая». */
export interface NotesHeaderActionSlotProps {
  workspaceId: string | undefined;
  /** Ask the host to show this note (switches to the active list and selects it). */
  onOpenNote: (noteId: string) => void;
}

/** notes.filters — a chip at the start of the filter row of the notes list. */
export interface NotesFilterSlotProps {
  workspaceId: string | undefined;
  active: boolean;
  onToggle: () => void;
}

/** notes.header.actions.end — a control after «Новая» in the Notes header (shown outside the template list). */
export interface NotesTemplatePickerSlotProps {
  workspaceId: string | undefined;
  onOpenNote: (noteId: string) => void;
}

/**
 * notes.templates — «a note can be a template». Draws nothing: its presence tells the host to offer the
 * template list view and the row/editor command; `meta.toggleLabel` is that command's wording.
 */
export type NotesTemplatesSlotProps = Record<string, never>;

/** finance.summary — extra cards in the Finance panel's summary row (grid children). */
export interface FinanceSummarySlotProps {
  workspaceId: string | undefined;
}

/** dashboard.finance — extra lines in the dashboard's «Финансы» card; `month` is «YYYY-MM» of today. */
export interface DashboardFinanceSlotProps {
  workspaceId: string | undefined;
  month: string;
}

/**
 * tasks.recurrence — the repeat controls of a task. Draws nothing by itself: `meta.api` holds the two
 * presentational pieces the host places (the form fields, the mark on a card). The stored rule and the
 * server's «next copy on completion» do not depend on it.
 */
export interface TaskRecurrenceApi {
  /** Renders «Повтор» (+ «Каждые N»); `variant` picks the surrounding form's label style. */
  Fields: ComponentType<{
    variant: "detail" | "form";
    freq: TaskRecurrence["freq"] | "";
    interval: string;
    onFreqChange: (freq: TaskRecurrence["freq"] | "") => void;
    onIntervalChange: (interval: string) => void;
  }>;
  /** The small repeat icon on a task card. */
  CardMark: ComponentType<Record<string, never>>;
}

export type TasksRecurrenceSlotProps = Record<string, never>;

/**
 * tasks.planning — subtasks, dependencies, planned start, estimate, hand-made order. A set of small
 * presentational parts (see `TaskRecurrenceApi` for the same idea): the forms interleave these fields
 * with the module's own, so the host places each piece where it always was. `variant` picks the label
 * style of the surrounding form (detail pane vs create form).
 */
export interface TaskPlanningApi {
  StartAt: ComponentType<{ variant: "detail" | "form"; value: string; onChange: (value: string) => void }>;
  EstimatedHours: ComponentType<{ variant: "detail" | "form"; value: string; onChange: (value: string) => void }>;
  Parent: ComponentType<{ variant: "detail" | "form"; value: string; options: { id: string; title: string }[]; onChange: (value: string) => void }>;
  Dependencies: ComponentType<{
    variant: "detail" | "form";
    selected: string[];
    options: { id: string; title: string }[];
    onToggle: (taskId: string, checked: boolean) => void;
  }>;
  /** The «Подзадачи» section of the detail pane. */
  SubtaskSection: ComponentType<{ workspaceId: string | undefined; parent: Task; tasks: Task[]; onOpen: (taskId: string) => void }>;
  /** «3/5» on a card whose task has children. */
  SubtaskBadge: ComponentType<{ progress: { total: number; done: number } }>;
  /** «заблокирована» on a card with unfinished dependencies. */
  BlockedBadge: ComponentType<Record<string, never>>;
}

export type TasksPlanningSlotProps = Record<string, never>;

/**
 * projects.tabs — a tab of a project's own page (next to Обзор / Задачи / Материалы / Доступ). The host draws the
 * tab strip from each contribution's `meta`; `needsModule` hides the tab when that module is off. The same
 * contribution is what the detached «План проекта» panel renders, so the plan is one component in both places.
 */
export interface ProjectTabSlotProps {
  workspaceId: string | undefined;
  projectId: string;
}

/** projects.overview.plan — the «План» block of the project overview; shown only when a plan plugin is on. */
export interface ProjectOverviewPlanSlotProps {
  milestones: Milestone[];
  tasks: Task[];
  onOpenPlan: () => void;
}

/**
 * inventory.alerts — the low-stock threshold. Draws nothing by itself: `meta.api` holds the presentational
 * parts the host places (summary card, item badge, hint, threshold field). The host still colours the
 * balance red when an alerts plugin is on.
 */
export interface InventoryAlertsApi {
  SummaryStat: ComponentType<{ count: number }>;
  ItemBadge: ComponentType<Record<string, never>>;
  /** The hint under the balance of one item. */
  balanceHint: (lowStock: boolean) => string;
  MinStockField: ComponentType<{ value: string; onChange: (value: string) => void }>;
}

export type InventoryAlertsSlotProps = Record<string, never>;

/** calendar.event.recurrence — the «Повтор» section of the event form. `value` is the starting rule; changes come back through `onChange`. */
export interface EventRecurrenceSlotProps {
  value: RecurrenceSpec | null;
  onChange: (value: RecurrenceSpec | null) => void;
}

/** calendar.event.reminders — the «Напоминания» section of the event form (minutes before the start). */
export interface EventRemindersSlotProps {
  value: number[];
  onChange: (value: number[]) => void;
}

/** finance.transactions.top — a block above the list of operations (the quick-entry line). */
export interface FinanceTransactionsTopSlotProps {
  workspaceId: string | undefined;
}

/**
 * inventory.costing — prices of receipts and the average cost. Draws nothing by itself: `meta.api` holds the
 * presentational parts the host places (a line on the card, the stat in the item's window, the price field of a receipt).
 */
export interface InventoryCostingApi {
  CardLine: ComponentType<{ avgCostMinor: number | null }>;
  DetailStat: ComponentType<{ avgCostMinor: number | null }>;
  UnitCostField: ComponentType<{ value: string; onChange: (value: string) => void }>;
}

export type InventoryCostingSlotProps = Record<string, never>;

/**
 * lists.item — what a bridge plugin adds to one entry of a list (ADR-0009). Draws nothing by itself:
 * `meta.api.ItemExtra` sits after the entry's label, and `completeItem` may take over ticking an
 * entry. It returns `null` to let the host tick the entry as usual, or the promise of its own
 * completion (the host then shows an error toast if it rejects). `isModuleEnabled` lets a bridge
 * stand down when the module on its other end is off.
 */
export interface ListsItemContext {
  api: ApiClient;
  queryClient: QueryClient;
  workspaceId: string;
  listId: string;
  item: ListItem;
  isModuleEnabled: (id: OrionModuleId) => boolean;
}

export interface ListsItemApi {
  ItemExtra: ComponentType<{ workspaceId: string; listId: string; item: ListItem }>;
  completeItem: (context: ListsItemContext) => Promise<void> | null;
}

export type ListsItemSlotProps = Record<string, never>;

/** inventory.item.actions — extra actions in the window of one stock item (ADR-0009: «В список покупок»). */
export interface InventoryItemActionsSlotProps {
  workspaceId: string;
  item: InventoryItem;
}

/**
 * shell.sidebar.widgets — a compact surface of a module shown in the sidebar (Widget Surface).
 * The host decides where it sits and whether the rail is `open`; the plugin only draws itself
 * and asks the host to open its full screen via `onOpenCalendar`-style callbacks.
 */
export interface SidebarWidgetSlotProps {
  workspaceId: string | undefined;
  /** The sidebar is expanded; a collapsed rail has no room for a widget. */
  open: boolean;
  onOpenCalendar: () => void;
}

export interface OpportunitiesViewSlotProps { workspaceId: string; workspaceLabel: string; canManage: boolean; onDirtyChange: (dirty: boolean) => void }
export interface OpportunitiesDetailsSlotProps { workspaceId: string; opportunity: import("@orion/shared-types").Opportunity; canManage: boolean }
export interface HomeObjectTabSlotProps { workspaceId: string | undefined; home: import("@orion/shared-types").Home; overview: import("@orion/shared-types").HomeOverview; financeAvailable: boolean; onOpenTab?: (tabId: string) => void }
export interface SlotContracts {
  "home.object.tabs": HomeObjectTabSlotProps;
  "home.object.overview.cards": HomeObjectTabSlotProps;
  "opportunities.views": OpportunitiesViewSlotProps;
  "opportunities.details.sections": OpportunitiesDetailsSlotProps;
  "shell.sidebar.widgets": SidebarWidgetSlotProps;
  "habits.insights": HabitsInsightsSlotProps;
  "habits.detail": HabitDetailSlotProps;
  "finance.tabs": FinanceTabSlotProps;
  "tasks.views.bar": TasksViewsBarSlotProps;
  "documents.history": DocumentsHistorySlotProps;
  "documents.editor": DocumentsEditorSlotProps;
  "documents.create": DocumentsCreateSlotProps;
  "notes.history": NotesHistorySlotProps;
  "time.insights": TimeInsightsSlotProps;
  "time.billing": TimeBillingSlotProps;
  "calendar.toolbar": CalendarToolbarSlotProps;
  "tasks.detail.tabs": TaskDetailTabSlotProps;
  "tasks.views": TasksViewSlotProps;
  "notes.header.actions": NotesHeaderActionSlotProps;
  "notes.filters": NotesFilterSlotProps;
  "notes.header.actions.end": NotesTemplatePickerSlotProps;
  "notes.templates": NotesTemplatesSlotProps;
  "finance.summary": FinanceSummarySlotProps;
  "dashboard.finance": DashboardFinanceSlotProps;
  "tasks.recurrence": TasksRecurrenceSlotProps;
  "tasks.planning": TasksPlanningSlotProps;
  "projects.tabs": ProjectTabSlotProps;
  "projects.overview.plan": ProjectOverviewPlanSlotProps;
  "inventory.alerts": InventoryAlertsSlotProps;
  "inventory.costing": InventoryCostingSlotProps;
  "inventory.item.actions": InventoryItemActionsSlotProps;
  "lists.item": ListsItemSlotProps;
  "calendar.event.recurrence": EventRecurrenceSlotProps;
  "calendar.event.reminders": EventRemindersSlotProps;
  "finance.transactions.top": FinanceTransactionsTopSlotProps;
}

export type SlotName = keyof SlotContracts;

/**
 * Extra, typed information a contribution gives the HOST about itself (not props for the
 * component). Only slots that need it are listed; for the rest `meta` is absent.
 */
export interface SlotMeta {
  "home.object.tabs": { tabId: string; label: string };
  "opportunities.views": { tabId: string; label: string; ownerOnly?: boolean };
  "finance.tabs": { tabId: string; label: string };
  "documents.history": { actionLabel: string };
  "documents.editor": { handles: (doc: DocumentItem) => boolean };
  "notes.history": { buttonLabel: string };
  "time.billing": { api: TimeBillingApi };
  /** `before`: the tab goes before the built-in ones (default after them). */
  "tasks.detail.tabs": { tabId: string; label: string; before?: boolean };
  "tasks.views": TasksViewMeta;
  "notes.templates": { toggleLabel: (note: Note) => string };
  "tasks.recurrence": { api: TaskRecurrenceApi };
  "tasks.planning": { api: TaskPlanningApi };
  "projects.tabs": { tabId: string; label: string; needsModule?: OrionModuleId };
  "inventory.alerts": { api: InventoryAlertsApi };
  "inventory.costing": { api: InventoryCostingApi };
  "lists.item": { api: ListsItemApi };
  "documents.create": { actions: DocumentCreateAction[] };
}

export type MetaOf<S extends SlotName> = S extends keyof SlotMeta ? SlotMeta[S] : undefined;
