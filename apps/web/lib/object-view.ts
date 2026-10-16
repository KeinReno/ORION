import { viewRefSchema, type ViewRef } from "@orion/shared-types";

const DETAIL_PANELS: Readonly<Record<string, string>> = { task: "task", note: "note", project: "project", list: "list" };
const PROJECT_VIEWS: Readonly<Record<string, string>> = { tasks: "projecttasks", materials: "projectmaterials", plan: "projectplan", access: "projectaccess" };

/** Only registered standalone views, in this window's workspace. Never guess a panel from a title. */
export function objectViewPanel(ref: ViewRef, activeWorkspaceId: string | null): string | null {
  const parsed = viewRefSchema.safeParse(ref);
  if (!parsed.success || parsed.data.object.workspaceId !== activeWorkspaceId) return null;
  const { object, viewId } = parsed.data;
  const kind = viewId === "detail" ? DETAIL_PANELS[object.entityType]
    : object.entityType === "project" && Object.prototype.hasOwnProperty.call(PROJECT_VIEWS, viewId) ? PROJECT_VIEWS[viewId] : undefined;
  return kind ? `${kind}:${object.entityId}` : null;
}
