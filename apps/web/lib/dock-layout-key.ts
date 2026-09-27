/**
 * U04 (24-CONNECTED-CORE-BACKLOG.md) — 23-UNIVERSAL-CONNECTED-CORE.md's
 * "Независимые окна и раскладки" contract: "Layout ключуется пользователем,
 * пространством и назначением раскладки" (layout is keyed by user, workspace
 * and layout purpose). Before U04 the Workbench's dockview layout lived under
 * one fixed `localStorage` key (`orion.dockLayout`) shared by every
 * user/workspace on the machine — switching workspace in the sidebar select
 * (`apps/web/app/(app)/layout.tsx`) never touched it, so panel positions from
 * one space leaked into whatever space you switched to, and a shared machine
 * with two local accounts would hand account B account A's saved layout.
 *
 * `purpose` defaults to `"main"` — the single Workbench dock rendered by
 * `app/(app)/layout.tsx`. It exists as a parameter (not hardcoded into the
 * key) because a future per-window or per-detached-panel layout (U06) is a
 * second purpose sharing this same key scheme, not a reason to invent a
 * second one.
 */
export function dockLayoutStorageKey(userId: string, workspaceId: string, purpose = "main"): string {
  return `orion.dockLayout:${purpose}:${userId}:${workspaceId}`;
}
