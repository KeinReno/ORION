import { effectiveDisabledModules, isModuleEnabled, type OrionModuleId } from "@orion/shared-types";
import { useActiveWorkspace } from "./use-active-workspace";

export function useEnabledModules(): {
  disabledModules: readonly string[];
  isEnabled: (id: OrionModuleId) => boolean;
} {
  const { workspace } = useActiveWorkspace();
  // Disabled for everyone, plus restricted-to-owner/lead modules when the
  // viewer is a plain member — see `effectiveDisabledModules`.
  const disabledModules = workspace
    ? effectiveDisabledModules({
        disabledModules: workspace.disabledModules,
        restrictedModules: workspace.restrictedModules,
        role: workspace.role
      })
    : [];
  return {
    disabledModules,
    isEnabled: (id) => isModuleEnabled(disabledModules, id)
  };
}
