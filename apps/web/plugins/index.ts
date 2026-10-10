import dynamic from "next/dynamic";
import type { FinanceTabSlotProps, HabitDetailSlotProps, HabitsInsightsSlotProps } from "../lib/extensions/contracts";
import { contribute } from "../lib/extensions/registry";

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
