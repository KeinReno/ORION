import { useWorkspaces } from "@orion/core-react";
import type { Workspace } from "@orion/shared-types";

/**
 * v0 has no workspace switcher UI yet — every user gets exactly one personal
 * workspace on register, so "active" is simply the first one returned.
 */
export function useActiveWorkspace(): { workspace: Workspace | undefined; isLoading: boolean } {
  const { data, isLoading } = useWorkspaces();
  return { workspace: data?.[0], isLoading };
}
