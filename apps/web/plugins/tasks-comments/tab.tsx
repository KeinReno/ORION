"use client";

import type { TaskDetailTabSlotProps } from "../../lib/extensions/contracts";
import { TaskCommentsSection } from "./task-comments";

/** Plugin `tasks-comments`: the «Комментарии» tab of a task. */
export function TaskCommentsTab({ workspaceId, taskId }: TaskDetailTabSlotProps): React.ReactElement {
  return <TaskCommentsSection workspaceId={workspaceId} taskId={taskId} />;
}
