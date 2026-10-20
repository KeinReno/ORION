"use client";

import type { ReactNode } from "react";
import "../../plugins";
import "../../plugins-ext/contributions.generated";
import { useEnabledPlugins } from "../use-enabled-plugins";
import type { SlotContracts, SlotName } from "./contracts";
import { extensionRegistry, type Contribution } from "./registry";
import { renderContributions } from "./slot-boundary";

/** The contributions of `slot` that are on in the active workspace (host module on, plugin on). */
export function useSlotContributions<S extends SlotName>(slot: S): Contribution<S>[] {
  const { isEnabled } = useEnabledPlugins();
  return extensionRegistry.enabled(slot, isEnabled);
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
