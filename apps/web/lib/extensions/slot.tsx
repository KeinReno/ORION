"use client";

import { isOrionPluginId } from "@orion/shared-types";
import { useSyncExternalStore, type ReactNode } from "react";
import "../../plugins";
import "../../plugins-ext/contributions.generated";
import { useEnabledPlugins } from "../use-enabled-plugins";
import type { SlotContracts, SlotName } from "./contracts";
import { extensionRegistry, type Contribution } from "./registry";
import { renderContributions } from "./slot-boundary";

/** The contributions of `slot` that are on in the active workspace (host module on, plugin on). */
export function useSlotContributions<S extends SlotName>(slot: S): Contribution<S>[] {
  // Re-render when an extension loaded at run time adds or removes a contribution (ADR-0022, E5).
  useSyncExternalStore(extensionRegistry.subscribe, extensionRegistry.version, extensionRegistry.version);
  const { isEnabled } = useEnabledPlugins();
  return extensionRegistry.enabled(slot, (id) => isOrionPluginId(id) && isEnabled(id));
}

/**
 * Renders whatever enabled plugins contribute to `slot`. With none enabled it renders
 * nothing at all — not an empty box — so a host can lay itself out for "no plugin" by
 * asking `useSlotContributions(slot).length` instead of guessing.
 *
 * `wrapperClassName` wraps the contributions in one element, only when there are any.
 */
export function ExtensionSlot<S extends SlotName>({
  name,
  props,
  wrapperClassName
}: {
  name: S;
  props: SlotContracts[S];
  wrapperClassName?: string;
}): ReactNode {
  const contributions = useSlotContributions(name);
  if (contributions.length === 0) return null;
  // Each contribution gets its own error boundary (see slot-boundary.tsx).
  const body = renderContributions(name, contributions, props);
  return wrapperClassName ? <div className={wrapperClassName}>{body}</div> : <>{body}</>;
}

/**
 * The outlet behind `ctx.slot(name)` of a run-time extension (ADR-0022, E5): renders what other extensions contribute
 * to `<extension id>.<name>`. Such a slot is not in `SlotContracts`, so its props are whatever the extension passes.
 */
export function extensionOutlet(slot: string): (props: Record<string, unknown>) => ReactNode {
  const name = slot as SlotName;
  function Outlet(props: Record<string, unknown>): ReactNode {
    const contributions = useSlotContributions(name);
    if (contributions.length === 0) return null;
    return <>{renderContributions(name, contributions, props as never)}</>;
  }
  Outlet.displayName = `ExtensionOutlet(${slot})`;
  return Outlet;
}
