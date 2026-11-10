// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из plugins-ext/*/plugin.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import dynamic from "next/dynamic";
import type { SlotContracts } from "../lib/extensions/contracts";
import { contribute } from "../lib/extensions/registry";

/** Вклады и места плагинов, подключённых манифестом; импорт этого файла (lib/extensions/slot.tsx) их регистрирует. */

const AgentHubTaskAssignmentAgentHubTaskAssignmentAction = dynamic<SlotContracts["tasks.context.actions"]>(() => import("./agent-hub-task-assignment/task-assignment").then((module) => module.AgentHubTaskAssignmentAction), { ssr: false });
contribute("tasks.context.actions", { pluginId: "agent-hub-task-assignment", component: AgentHubTaskAssignmentAgentHubTaskAssignmentAction, meta: {"actionId":"assign-agent","label":"Назначить ИИ-агента…"} });

const HabitsInsightsHabitsInsights = dynamic<SlotContracts["habits.insights"]>(() => import("./habits-insights/insights").then((module) => module.HabitsInsights), { ssr: false });
contribute("habits.insights", { pluginId: "habits-insights", component: HabitsInsightsHabitsInsights });

const HabitsInsightsHabitDetailInsights = dynamic<SlotContracts["habits.detail"]>(() => import("./habits-insights/detail").then((module) => module.HabitDetailInsights), { ssr: false });
contribute("habits.detail", { pluginId: "habits-insights", component: HabitsInsightsHabitDetailInsights });
