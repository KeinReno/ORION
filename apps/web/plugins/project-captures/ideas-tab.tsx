"use client";

import type { ProjectTabSlotProps } from "../../lib/extensions/contracts";
import { ProjectCaptureBoard } from "./capture-board";

/** Plugin `projects-ideas`: thoughts pinned to this project, later turned into its tasks. */
export function ProjectIdeasTab(props: ProjectTabSlotProps): React.ReactElement {
  return <ProjectCaptureBoard {...props} kind="idea" />;
}
