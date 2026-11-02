/** Pure planner shared by CLI and authenticated API; no authorization or writes. */
export interface DevelopmentPlanAction {
  kind: "workspace" | "project" | "task";
  externalId?: string;
  name?: string;
  title?: string;
  projectExternalId?: string;
  dependsOn?: string[];
  action: "already_mapped" | "review_possible_match" | "propose_create";
  candidateId?: string | null;
  candidateIds?: string[];
}
export function planOrionDevImport(catalog: unknown, snapshot?: unknown): {
  mode: "dry-run"; catalogId: string; workspaceId: string | null;
  warning: string; actions: DevelopmentPlanAction[];
};
