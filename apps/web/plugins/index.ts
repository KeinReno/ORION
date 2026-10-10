import dynamic from "next/dynamic";
import type { FinanceTabSlotProps, HabitDetailSlotProps, HabitsInsightsSlotProps, TasksViewsBarSlotProps, DocumentsHistorySlotProps, DocumentsEditorSlotProps, DocumentsCreateSlotProps, NotesHistorySlotProps, TimeBillingSlotProps, TimeInsightsSlotProps, CalendarToolbarSlotProps } from "../lib/extensions/contracts";
import { FileSpreadsheet, FileText } from "lucide-react";
import type { ComponentType } from "react";
import { contribute } from "../lib/extensions/registry";
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
