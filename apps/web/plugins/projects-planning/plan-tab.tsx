"use client";

import type { ProjectTabSlotProps } from "../../lib/extensions/contracts";
import { ProjectPlan } from "./plan-views";

/** Plugin `projects-planning`: the «План» tab of a project (timeline, roadmap, calendar, Gantt). */
export function ProjectPlanTab({ projectId }: ProjectTabSlotProps): React.ReactElement {
  return <ProjectPlan projectId={projectId} />;
}
