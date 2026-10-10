import type { ComponentType } from "react";
import type { OrionPluginId } from "@orion/shared-types";
import type { SlotContracts, SlotName } from "./contracts";

/**
 * The extension registry: which plugin contributes which component to which slot.
 *
 * It is deliberately small and compiled-in (docs/PLAN.md rejected a runtime that loads
 * foreign code): a plugin is a unit at the same trust level as a module. What it adds
 * is the BOUNDARY the architecture documents ask for — a host module renders a slot and
 * knows nothing about who fills it; a plugin fills a slot and knows only that slot's
 * typed props. Switch the plugin off and the slot is simply empty; the host keeps working.
 *
 * Pure (no React state, no storage) so the rules are tested: see registry.test.ts.
 */

export interface Contribution<S extends SlotName> {
  pluginId: OrionPluginId;
  component: ComponentType<SlotContracts[S]>;
  /** Lower first. Ties keep registration order. */
  order?: number;
}

export interface ExtensionRegistry {
  contribute<S extends SlotName>(slot: S, contribution: Contribution<S>): void;
  /** Contributions of `slot` whose plugin is enabled, in order. */
  enabled<S extends SlotName>(slot: S, isPluginEnabled: (id: OrionPluginId) => boolean): Contribution<S>[];
  /** Every contribution of `slot`, enabled or not (for diagnostics and the plugins screen). */
  all<S extends SlotName>(slot: S): Contribution<S>[];
}

export function createRegistry(): ExtensionRegistry {
  const table = new Map<SlotName, Contribution<SlotName>[]>();
  const list = <S extends SlotName>(slot: S): Contribution<S>[] => (table.get(slot) ?? []) as unknown as Contribution<S>[];
  return {
    contribute(slot, contribution) {
      const existing = list(slot);
      // The same plugin filling the same slot twice is a registration bug, not a feature: keep the first.
      if (existing.some((item) => item.pluginId === contribution.pluginId)) return;
      table.set(slot, [...existing, contribution] as unknown as Contribution<SlotName>[]);
    },
    all: (slot) => [...list(slot)],
    enabled(slot, isPluginEnabled) {
      return list(slot)
        .map((contribution, index) => ({ contribution, index }))
        .filter(({ contribution }) => isPluginEnabled(contribution.pluginId))
        .sort((a, b) => (a.contribution.order ?? 0) - (b.contribution.order ?? 0) || a.index - b.index)
        .map(({ contribution }) => contribution);
    }
  };
}

/** The application-wide registry the compiled-in plugins register into (see apps/web/plugins/index.ts). */
export const extensionRegistry: ExtensionRegistry = createRegistry();

export function contribute<S extends SlotName>(slot: S, contribution: Contribution<S>): void {
  extensionRegistry.contribute(slot, contribution);
}
