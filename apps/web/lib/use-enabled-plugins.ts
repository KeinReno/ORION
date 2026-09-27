import { isModuleEnabled, isPluginEnabled, PLUGIN_CATALOG, type OrionPluginId } from "@orion/shared-types";
import { useActiveWorkspace } from "./use-active-workspace";

/** Mirrors useEnabledModules, plus the plugin auto-disable rule: off if its host module is off, even if the plugin toggle itself is on. */
export function useEnabledPlugins(): {
  pluginOverrides: readonly string[];
  isEnabled: (id: OrionPluginId) => boolean;
} {
  const { workspace } = useActiveWorkspace();
  const pluginOverrides = workspace?.pluginOverrides ?? [];
  const disabledModules = workspace?.disabledModules ?? [];
  return {
    pluginOverrides,
    isEnabled: (id) => {
      const manifest = PLUGIN_CATALOG.find((item) => item.id === id);
      if (!manifest) return false;
      return isPluginEnabled(pluginOverrides, id) && isModuleEnabled(disabledModules, manifest.extendsModuleId);
    }
  };
}
