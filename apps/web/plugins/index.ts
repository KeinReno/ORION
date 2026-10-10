import dynamic from "next/dynamic";
import type { HabitDetailSlotProps, HabitsInsightsSlotProps } from "../lib/extensions/contracts";
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
