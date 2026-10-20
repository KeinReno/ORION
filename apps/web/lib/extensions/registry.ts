import type { ComponentType } from "react";
import type { MetaOf, SlotContracts, SlotName } from "./contracts";

/**
 * The extension registry: which plugin contributes which component to which slot.
 *
 * A host module renders a slot and knows nothing about who fills it; a plugin fills a slot and knows only that slot's
 * typed props. Switch the plugin off and the slot is simply empty; the host keeps working.
 *
 * Plugins of the main build register at import time. Since ADR-0022 (E5) an extension loaded from the folder at run
 * time contributes too: its contributions carry `runtime: true` (the loader adds them only while the extension is on
 * here, and removes them with the returned undo), and subscribers re-render when the table changes.
 */
export interface Contribution<S extends SlotName> {
  /** Plugin of the main build (`OrionPluginId`) or, with `runtime`, the id of an extension from the folder. */
  pluginId: string;
  component: ComponentType<SlotContracts[S]>;
  /** Lower first. Ties keep registration order. */
  order?: number;
  /** What the host needs to know to place it (e.g. a tab's id and label) — typed per slot, see `SlotMeta`. */
  meta?: MetaOf<S>;
  /** Added by the run-time extension loader; its owner's on/off state is the loader's business, not the catalog's. */
  runtime?: boolean;
}

export interface ExtensionRegistry {
  /** Adds a contribution; returns its undo. The same owner filling the same slot twice keeps the first. */
  contribute<S extends SlotName>(slot: S, contribution: Contribution<S>): () => void;
  /** Contributions of `slot` whose owner is enabled (`isPluginEnabled` for catalog plugins; run-time ones always), in order. */
  enabled<S extends SlotName>(slot: S, isPluginEnabled: (id: string) => boolean): Contribution<S>[];
  /** Every contribution of `slot`, enabled or not (for diagnostics and the plugins screen). */
  all<S extends SlotName>(slot: S): Contribution<S>[];
  subscribe(listener: () => void): () => void;
  /** Grows on every change — the snapshot for `useSyncExternalStore`. */
  version(): number;
}

export function createRegistry(): ExtensionRegistry {
  const table = new Map<SlotName, Contribution<SlotName>[]>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = (): void => {
    revision += 1;
    for (const listener of listeners) listener();
  };
  const list = <S extends SlotName>(slot: S): Contribution<S>[] => (table.get(slot) ?? []) as unknown as Contribution<S>[];
  return {
    contribute(slot, contribution) {
      const existing = list(slot);
      // The same plugin filling the same slot twice is a registration bug, not a feature: keep the first.
      if (existing.some((item) => item.pluginId === contribution.pluginId)) return () => undefined;
      table.set(slot, [...existing, contribution] as unknown as Contribution<SlotName>[]);
      changed();
      return () => {
        const current = list(slot);
        if (!current.includes(contribution)) return;
        table.set(slot, current.filter((item) => item !== contribution) as unknown as Contribution<SlotName>[]);
        changed();
      };
    },
    all: (slot) => [...list(slot)],
    enabled(slot, isPluginEnabled) {
      return list(slot)
        .map((contribution, index) => ({ contribution, index }))
        .filter(({ contribution }) => contribution.runtime === true || isPluginEnabled(contribution.pluginId))
        .sort((a, b) => (a.contribution.order ?? 0) - (b.contribution.order ?? 0) || a.index - b.index)
        .map(({ contribution }) => contribution);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => revision
  };
}

export const extensionRegistry: ExtensionRegistry = createRegistry();

export function contribute<S extends SlotName>(slot: S, contribution: Contribution<S>): () => void {
  return extensionRegistry.contribute(slot, contribution);
}
