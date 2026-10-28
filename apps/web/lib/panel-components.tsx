"use client";

import { ObjectContextScope } from "@orion/core-react";
import { Button, ErrorBoundary, type IDockviewPanelProps } from "@orion/ui";
import { createElement } from "react";
import { AgentPanelFrame } from "./agent-presence";
import { panelRegistry } from "./panel-registry";
import { PanelDraftScope } from "./unsaved-drafts";
import { PanelScrollMemory } from "./scroll-memory";

function PanelCrash({ error, onRetry }: { error: Error; onRetry: () => void }): React.ReactElement {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-foreground">Панель не открылась из-за ошибки</p>
      <p className="max-w-md break-words font-mono text-2xs text-muted-foreground">{error.message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
}

/**
 * The dockview `components` map, shared by the primary Workbench
 * (`app/(app)/layout.tsx`) and the second, independent dock (ORION-11,
 * `secondary-dock.ts` / `app/panel/secondary`) — both need the exact same
 * registry → component wiring (error boundary, agent-presence frame, scroll
 * memory, draft/object-context scoping), and a second hand-copied version
 * would drift the moment one of these wrappers changes.
 */
export function buildPanelComponents(): Record<string, (props: IDockviewPanelProps) => React.ReactElement> {
  return Object.fromEntries(
    panelRegistry.map((panel) => [
      panel.id,
      (props: IDockviewPanelProps) =>
        createElement(
          ErrorBoundary,
          {
            fallback: (error: Error, reset: () => void) => createElement(PanelCrash, { error, onRetry: reset }),
            onError: (error: Error) => console.error(`[panels] panel "${panel.id}" crashed`, error)
          },
          createElement(AgentPanelFrame, {
            moduleId: panel.moduleId ?? null,
            children: createElement(PanelScrollMemory, { panelId: props.api.id }, createElement(PanelDraftScope, { panelId: props.api.id }, createElement(ObjectContextScope, { panelId: props.api.id }, createElement(panel.component, { params: props.params, api: props.api }))))
          })
        )
    ])
  );
}
