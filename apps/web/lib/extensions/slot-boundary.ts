import { Fragment, createElement, type ReactNode } from "react";
import { ErrorBoundary } from "@orion/ui";
import type { SlotContracts, SlotName } from "./contracts";
import type { Contribution } from "./registry";

// Plain .ts with createElement (no JSX) so vitest can import it without a JSX transform.

/**
 * Compact inline fallback: a plugin that throws must not take the host or its sibling
 * contributions down, and in a toolbar-sized slot it must not shout either.
 */
export function PluginFallback({ pluginId, onRetry }: { pluginId: string; onRetry: () => void }): ReactNode {
  return createElement(
    "span",
    { role: "alert", className: "inline-flex items-center gap-1.5 text-2xs text-muted-foreground" },
    `Расширение «${pluginId}» не загрузилось`,
    createElement(
      "button",
      { type: "button", onClick: onRetry, className: "rounded px-1 text-accent-text underline-offset-2 hover:underline" },
      "Повторить"
    )
  );
}

/** One boundary per contribution so siblings keep rendering. Logged once per failure, with plugin and slot ids. */
export function renderContributions<S extends SlotName>(slot: S, contributions: Contribution<S>[], props: SlotContracts[S]): ReactNode[] {
  return contributions.map(({ pluginId, component }) =>
    createElement(
      Fragment,
      { key: pluginId },
      createElement(
        ErrorBoundary,
        {
          fallback: (_error, reset) => createElement(PluginFallback, { pluginId, onRetry: reset }),
          onError: (error) => console.error(`[extensions] plugin "${pluginId}" failed in slot "${slot}"`, error)
        },
        createElement(component as never, props as never)
      )
    )
  );
}
