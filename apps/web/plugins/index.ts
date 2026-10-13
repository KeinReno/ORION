import dynamic from "next/dynamic";
import type { FinanceTabSlotProps, HabitDetailSlotProps, HabitsInsightsSlotProps, TasksViewsBarSlotProps, DocumentsHistorySlotProps, DocumentsEditorSlotProps, DocumentsCreateSlotProps, NotesHistorySlotProps, TimeBillingSlotProps, TimeInsightsSlotProps, CalendarToolbarSlotProps, TaskDetailTabSlotProps, TasksViewSlotProps, NotesHeaderActionSlotProps, NotesFilterSlotProps, NotesTemplatePickerSlotProps, NotesTemplatesSlotProps, FinanceSummarySlotProps, DashboardFinanceSlotProps, TasksRecurrenceSlotProps, TasksPlanningSlotProps, ProjectTabSlotProps, ProjectOverviewPlanSlotProps, InventoryAlertsSlotProps, InventoryCostingSlotProps, EventRecurrenceSlotProps, EventRemindersSlotProps, FinanceTransactionsTopSlotProps } from "../lib/extensions/contracts";
import { FileSpreadsheet, FileText } from "lucide-react";
import type { ComponentType } from "react";
import { contribute } from "../lib/extensions/registry";
import { inventoryAlertsApi } from "./inventory-alerts/alerts";
import { inventoryCostingApi } from "./inventory-costing/costing";
import { taskPlanningApi } from "./tasks-planning/planning";
import { taskRecurrenceApi } from "./tasks-recurrence/recurrence";
import { timeBillingApi } from "./time-billing/billing";
import { isOfficeFile } from "../lib/office/office-kind";

/**
 * Every compiled-in plugin registers here, once, what it adds to which slot. The components
 * are loaded lazily, so a plugin that is switched off costs the page nothing.
 *
 * Importing this file (done by `lib/extensions/slot.tsx`) is what registers them.
 */

const HabitsInsights = dynamic<HabitsInsightsSlotProps>(
  () => import("./habits-insights/insights").then((module) => module.HabitsInsights),
  { ssr: false }
);

const HabitDetailInsights = dynamic<HabitDetailSlotProps>(
  () => import("./habits-insights/detail").then((module) => module.HabitDetailInsights),
  { ssr: false }
);

contribute("habits.insights", { pluginId: "habits-insights", component: HabitsInsights });
contribute("habits.detail", { pluginId: "habits-insights", component: HabitDetailInsights });

/**
 * Finance tabs. Each is a self-contained view; the host draws the tab strip from `meta`.
 * `order` keeps the tabs where they always were: Транзакции, Счета (base), then these four.
 */
const BudgetsTab = dynamic<FinanceTabSlotProps>(() => import("./finance-budgeting/budgets-view").then((m) => m.BudgetsView), { ssr: false });
const GoalsTab = dynamic<FinanceTabSlotProps>(() => import("./finance-goals/goals-view").then((m) => m.GoalsView), { ssr: false });
const RecurringTab = dynamic<FinanceTabSlotProps>(() => import("./finance-recurring/recurring-view").then((m) => m.RecurringView), { ssr: false });
const ReportsTab = dynamic<FinanceTabSlotProps>(() => import("./finance-reports/reports-view").then((m) => m.ReportsView), { ssr: false });

contribute("finance.tabs", { pluginId: "finance-budgeting", component: BudgetsTab, order: 10, meta: { tabId: "budgets", label: "Бюджеты" } });
contribute("finance.tabs", { pluginId: "finance-goals", component: GoalsTab, order: 20, meta: { tabId: "goals", label: "Цели" } });
contribute("finance.tabs", { pluginId: "finance-recurring", component: RecurringTab, order: 30, meta: { tabId: "recurring", label: "Повторяющиеся" } });
contribute("finance.tabs", { pluginId: "finance-reports", component: ReportsTab, order: 40, meta: { tabId: "reports", label: "Отчёты" } });

const SavedViews = dynamic<TasksViewsBarSlotProps>(() => import("./tasks-saved-views/saved-views").then((m) => m.SavedViewsBar), { ssr: false });
contribute("tasks.views.bar", { pluginId: "tasks-saved-views", component: SavedViews });

const DocumentHistorySheet = dynamic<DocumentsHistorySlotProps>(() => import("./documents-history/history-sheet").then((m) => m.DocumentHistorySheet), { ssr: false });
contribute("documents.history", { pluginId: "documents-history", component: DocumentHistorySheet, meta: { actionLabel: "История версий…" } });

/** Documents office plugin. The codecs load on demand (first click / first office file), never with the panel. */
const OfficeEditorSlot = dynamic<DocumentsEditorSlotProps>(() => import("./documents-office/OfficeEditor").then((m) => m.OfficeEditor), { ssr: false });
const NoVisual = (): null => null;
contribute("documents.editor", {
  pluginId: "documents-office",
  component: OfficeEditorSlot,
  meta: { handles: isOfficeFile }
});
contribute("documents.create", {
  pluginId: "documents-office",
  component: NoVisual as unknown as ComponentType<DocumentsCreateSlotProps>,
  meta: {
    actions: [
      {
        id: "docx",
        menuLabel: "Новый документ",
        buttonLabel: "Документ",
        icon: FileText,
        successTitle: "Документ создан",
        createFile: async () => (await import("../lib/office/office-files")).createEmptyDocxFile()
      },
      {
        id: "xlsx",
        menuLabel: "Новая таблица",
        buttonLabel: "Таблица",
        icon: FileSpreadsheet,
        successTitle: "Таблица создана",
        createFile: async () => (await import("../lib/office/office-files")).createEmptyXlsxFile()
      }
    ]
  }
});

const NoteHistorySheet = dynamic<NotesHistorySlotProps>(() => import("./notes-history/history-sheet").then((m) => m.NoteHistorySheet), { ssr: false });
contribute("notes.history", { pluginId: "notes-history", component: NoteHistorySheet, meta: { buttonLabel: "История версий" } });

const TimeInsights = dynamic<TimeInsightsSlotProps>(() => import("./time-insights/insights").then((m) => m.TimeInsights), { ssr: false });
contribute("time.insights", { pluginId: "time-insights", component: TimeInsights });
// Billing draws nothing itself; its substance is `meta.api` (small, so it is not lazy).
contribute("time.billing", {
  pluginId: "time-billing",
  component: NoVisual as unknown as ComponentType<TimeBillingSlotProps>,
  meta: { api: timeBillingApi }
});

const CalendarExternalButton = dynamic<CalendarToolbarSlotProps>(() => import("./calendar-external/toolbar-button").then((m) => m.CalendarExternalButton), { ssr: false });
contribute("calendar.toolbar", { pluginId: "calendar-external", component: CalendarExternalButton });

const TaskCommentsTab = dynamic<TaskDetailTabSlotProps>(() => import("./tasks-comments/tab").then((m) => m.TaskCommentsTab), { ssr: false });
contribute("tasks.detail.tabs", { pluginId: "tasks-comments", component: TaskCommentsTab, order: 10, meta: { tabId: "comments", label: "Комментарии", before: true } });

// «Доска»: columns side by side (3 up to 640px, 4 from 1152px of panel width — the container queries the list never used).
contribute("tasks.views", {
  pluginId: "tasks-kanban",
  component: NoVisual as unknown as ComponentType<TasksViewSlotProps>,
  order: 10,
  meta: {
    viewId: "board",
    label: "Доска",
    layoutClass: (columnCount) =>
      columnCount <= 3
        ? "grid gap-4 [@container(min-width:640px)]:grid-cols-3"
        : "grid gap-4 [@container(min-width:640px)]:grid-cols-3 [@container(min-width:1152px)]:grid-cols-4"
  }
});

const DailyNoteButton = dynamic<NotesHeaderActionSlotProps>(() => import("./notes-daily/daily-button").then((m) => m.DailyNoteButton), { ssr: false });
contribute("notes.header.actions", { pluginId: "notes-daily", component: DailyNoteButton, order: 10 });

const TemplatesChip = dynamic<NotesFilterSlotProps>(() => import("./notes-templates/templates").then((m) => m.TemplatesChip), { ssr: false });
const TemplatePicker = dynamic<NotesTemplatePickerSlotProps>(() => import("./notes-templates/templates").then((m) => m.TemplatePicker), { ssr: false });
contribute("notes.filters", { pluginId: "notes-templates", component: TemplatesChip, order: 10 });
contribute("notes.header.actions.end", { pluginId: "notes-templates", component: TemplatePicker, order: 10 });
contribute("notes.templates", {
  pluginId: "notes-templates",
  component: NoVisual as unknown as ComponentType<NotesTemplatesSlotProps>,
  meta: { toggleLabel: (note) => (note.isTemplate ? "Убрать из шаблонов" : "Сделать шаблоном") }
});

// finance-budgeting also shows its numbers where the module summarises itself: the Finance summary row and the dashboard card.
const BudgetSummaryStat = dynamic<FinanceSummarySlotProps>(() => import("./finance-budgeting/summary").then((m) => m.BudgetSummaryStat), { ssr: false });
const BudgetDashboardLine = dynamic<DashboardFinanceSlotProps>(() => import("./finance-budgeting/summary").then((m) => m.BudgetDashboardLine), { ssr: false });
contribute("finance.summary", { pluginId: "finance-budgeting", component: BudgetSummaryStat, order: 10 });
contribute("dashboard.finance", { pluginId: "finance-budgeting", component: BudgetDashboardLine, order: 10 });

// Like billing: presentational pieces in `meta.api`, nothing drawn by the contribution itself.
contribute("tasks.recurrence", {
  pluginId: "tasks-recurrence",
  component: NoVisual as unknown as ComponentType<TasksRecurrenceSlotProps>,
  meta: { api: taskRecurrenceApi }
});

contribute("tasks.planning", {
  pluginId: "tasks-planning",
  component: NoVisual as unknown as ComponentType<TasksPlanningSlotProps>,
  meta: { api: taskPlanningApi }
});

// Plan of a project: a tab, the overview block, and (through the panel registry) the detached plan panel.
const ProjectPlanTab = dynamic<ProjectTabSlotProps>(() => import("./projects-planning/plan-tab").then((m) => m.ProjectPlanTab), { ssr: false });
const ProjectOverviewPlan = dynamic<ProjectOverviewPlanSlotProps>(() => import("./projects-planning/overview-plan").then((m) => m.ProjectOverviewPlan), { ssr: false });
contribute("projects.tabs", { pluginId: "projects-planning", component: ProjectPlanTab, order: 20, meta: { tabId: "plan", label: "План", needsModule: "tasks" } });
contribute("projects.overview.plan", { pluginId: "projects-planning", component: ProjectOverviewPlan, order: 10 });

const ProjectIdeasTab = dynamic<ProjectTabSlotProps>(() => import("./project-captures/ideas-tab").then((m) => m.ProjectIdeasTab), { ssr: false });
const ProjectProblemsTab = dynamic<ProjectTabSlotProps>(() => import("./project-captures/problems-tab").then((m) => m.ProjectProblemsTab), { ssr: false });
contribute("projects.tabs", { pluginId: "projects-ideas", component: ProjectIdeasTab, order: 30, meta: { tabId: "ideas", label: "Идеи" } });
contribute("projects.tabs", { pluginId: "projects-problems", component: ProjectProblemsTab, order: 40, meta: { tabId: "problems", label: "Проблемы" } });

contribute("inventory.alerts", {
  pluginId: "inventory-alerts",
  component: NoVisual as unknown as ComponentType<InventoryAlertsSlotProps>,
  meta: { api: inventoryAlertsApi }
});

const EventRecurrenceFields = dynamic<EventRecurrenceSlotProps>(() => import("./calendar-recurrence/recurrence-fields").then((m) => m.EventRecurrenceFields), { ssr: false });
const EventReminderFields = dynamic<EventRemindersSlotProps>(() => import("./calendar-reminders/reminder-fields").then((m) => m.EventReminderFields), { ssr: false });
contribute("calendar.event.recurrence", { pluginId: "calendar-recurrence", component: EventRecurrenceFields, order: 10 });
contribute("calendar.event.reminders", { pluginId: "calendar-reminders", component: EventReminderFields, order: 10 });

// FinControl-inspired finance helpers: a quick-entry line over the operations and a CSV import tab.
const QuickEntry = dynamic<FinanceTransactionsTopSlotProps>(() => import("./finance-quick-entry/quick-entry").then((m) => m.QuickEntry), { ssr: false });
const ImportTab = dynamic<FinanceTabSlotProps>(() => import("./finance-import/import-view").then((m) => m.ImportView), { ssr: false });
contribute("finance.transactions.top", { pluginId: "finance-quick-entry", component: QuickEntry, order: 10 });
contribute("finance.tabs", { pluginId: "finance-import", component: ImportTab, order: 50, meta: { tabId: "import", label: "Импорт" } });

const ObligationsTab = dynamic<FinanceTabSlotProps>(() => import("./finance-obligations/obligations-view").then((m) => m.ObligationsView), { ssr: false });
const ForecastTab = dynamic<FinanceTabSlotProps>(() => import("./finance-forecast/forecast-view").then((m) => m.ForecastView), { ssr: false });
contribute("finance.tabs", { pluginId: "finance-obligations", component: ObligationsTab, order: 35, meta: { tabId: "obligations", label: "Обязательства" } });
contribute("finance.tabs", { pluginId: "finance-forecast", component: ForecastTab, order: 45, meta: { tabId: "forecast", label: "Прогноз" } });
contribute("inventory.costing", {
  pluginId: "inventory-costing",
  component: NoVisual as unknown as ComponentType<InventoryCostingSlotProps>,
  meta: { api: inventoryCostingApi }
});
