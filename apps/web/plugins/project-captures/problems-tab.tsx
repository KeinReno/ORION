"use client";

import type { ProjectTabSlotProps } from "../../lib/extensions/contracts";
import { ProjectCaptureBoard } from "./capture-board";

/** Plugin `projects-problems`: bugs, dislikes and fixes pinned to this project. */
export function ProjectProblemsTab(props: ProjectTabSlotProps): React.ReactElement {
  return <ProjectCaptureBoard {...props} kind="problem" />;
}
