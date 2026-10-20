// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из plugins-ext/*/plugin.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import dynamic from "next/dynamic";
import type { SlotContracts } from "../lib/extensions/contracts";
import { contribute } from "../lib/extensions/registry";

/** Вклады плагинов, подключённых манифестом; импорт этого файла (lib/extensions/slot.tsx) их регистрирует. */

const HabitsInsightsHabitsInsights = dynamic<SlotContracts["habits.insights"]>(() => import("./habits-insights/insights").then((module) => module.HabitsInsights), { ssr: false });
contribute("habits.insights", { pluginId: "habits-insights", component: HabitsInsightsHabitsInsights });

const HabitsInsightsHabitDetailInsights = dynamic<SlotContracts["habits.detail"]>(() => import("./habits-insights/detail").then((module) => module.HabitDetailInsights), { ssr: false });
contribute("habits.detail", { pluginId: "habits-insights", component: HabitsInsightsHabitDetailInsights });
