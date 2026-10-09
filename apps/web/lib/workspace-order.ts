import type { Workspace, WorkspaceOrganization } from "@orion/shared-types";

export interface SwitcherGroup {
  label: string;
  workspaces: Workspace[];
}

/**
 * Pure — turns the flat `workspaces` list plus the user's personal
 * `organization` (U05) into display groups: "Избранное" first (independent of
 * sphere, may repeat a workspace also shown under its sphere — quick access is
 * the point), then each sphere in the user's own order, then "Другое" for
 * workspaces in no sphere. No spheres/favorites at all collapses to a single
 * ungrouped list — an old account without them keeps working.
 */
export function buildSwitcherGroups(
  workspaces: Workspace[],
  organization: WorkspaceOrganization | undefined
): SwitcherGroup[] {
  if (!organization || (organization.spheres.length === 0 && organization.favoriteWorkspaceIds.length === 0)) {
    return [{ label: "", workspaces }];
  }
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const groups: SwitcherGroup[] = [];

  const favorites = organization.favoriteWorkspaceIds.map((id) => byId.get(id)).filter((w): w is Workspace => Boolean(w));
  if (favorites.length > 0) groups.push({ label: "Избранное", workspaces: favorites });

  const sphered = new Set<string>();
  for (const sphere of [...organization.spheres].sort((a, b) => a.order - b.order)) {
    const sphereWorkspaces = sphere.workspaceIds.map((id) => byId.get(id)).filter((w): w is Workspace => Boolean(w));
    for (const w of sphereWorkspaces) sphered.add(w.id);
    if (sphereWorkspaces.length > 0) groups.push({ label: sphere.name, workspaces: sphereWorkspaces });
  }

  const rest = workspaces.filter((w) => !sphered.has(w.id));
  if (rest.length > 0) groups.push({ label: organization.spheres.length > 0 ? "Другое" : "", workspaces: rest });

  return groups;
}

/**
 * The order the previous/next arrows walk: the groups as shown, each workspace
 * once (a favourite repeated under its sphere counts at its first, favourite
 * position). Stable between renders, so "next" always means the same thing.
 */
export function switchOrder(groups: readonly SwitcherGroup[]): Workspace[] {
  const seen = new Set<string>();
  const order: Workspace[] = [];
  for (const group of groups) {
    for (const workspace of group.workspaces) {
      if (seen.has(workspace.id)) continue;
      seen.add(workspace.id);
      order.push(workspace);
    }
  }
  return order;
}

/** The neighbour of `activeId` in `order`, wrapping around. Nothing to switch to with fewer than two. */
export function neighborWorkspace(order: readonly Workspace[], activeId: string | undefined, step: 1 | -1): Workspace | undefined {
  if (order.length < 2) return undefined;
  const index = order.findIndex((workspace) => workspace.id === activeId);
  // An unknown active workspace: "next" starts from the top, "previous" from the end.
  if (index === -1) return step === 1 ? order[0] : order[order.length - 1];
  return order[(index + step + order.length) % order.length];
}

/** Groups narrowed by a name search (case-insensitive substring); empty groups drop out. */
export function filterSwitcherGroups(groups: readonly SwitcherGroup[], query: string): SwitcherGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups
    .map((group) => ({ ...group, workspaces: group.workspaces.filter((w) => w.name.toLowerCase().includes(needle)) }))
    .filter((group) => group.workspaces.length > 0);
}
