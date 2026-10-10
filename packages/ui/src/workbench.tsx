"use client";

import "dockview-react/dist/styles/dockview.css";
import {
  DockviewDefaultTab,
  DockviewReact,
  themeAbyss,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps
} from "dockview-react";
import type { FunctionComponent } from "react";

export type { DockviewApi, DockviewReadyEvent, IDockviewHeaderActionsProps, IDockviewPanelProps } from "dockview-react";
// U06: external (sidebar → dock) drag-and-drop rides on dockview's own
// built-in drop-zone machinery (`onWillShowOverlay`/`onUnhandledDragOverEvent`/
// `onDidDrop`, all exposed on `DockviewApi`) rather than a hand-rolled HTML5
// DnD implementation — see 12-PROGRESS.md's U06 entry for why. These are the
// pieces `apps/web/app/(app)/layout.tsx` needs to wire that up; re-exported
// here (not imported from `dockview-react` directly in app code) so the
// dockview dependency stays isolated to this one wrapper, same as every
// other dockview type already re-exported above.
export {
  positionToDirection,
  type Position,
  type DockviewGroupPanel,
  type DockviewDndOverlayEvent,
  type DockviewWillShowOverlayLocationEvent,
  type DockviewDidDropEvent
} from "dockview-react";

/**
 * The standard tab plus "middle button closes it". Dockview's own middle-click handling relies
 * on pointer events that its drag machinery swallows, so it never fired here; the browser's
 * `auxclick` is not affected. `display: contents` keeps the wrapper out of the tab's layout.
 */
function OrionTab(props: IDockviewPanelHeaderProps): React.ReactElement {
  return (
    <div
      style={{ display: "contents" }}
      onMouseDown={(event) => {
        // Stops the browser's middle-button autoscroll from starting on the tab.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        props.api.close();
      }}
    >
      <DockviewDefaultTab {...props} />
    </div>
  );
}

export interface WorkbenchProps {
  /** Panel id -> component. Mirrors the module registry: adding a module means adding one entry here. */
  components: Record<string, FunctionComponent<IDockviewPanelProps>>;
  onReady: (event: DockviewReadyEvent) => void;
  /** Rendered in every group's tab bar, e.g. ORION's "detach to window" button. */
  rightHeaderActionsComponent?: FunctionComponent<IDockviewHeaderActionsProps>;
}

/**
 * Thin wrapper around dockview-react with ORION's dark theme — the actual
 * panel registry and layout logic live in apps/web, this just owns the
 * look. See ORION v0.5 plan for why dockview (MIT, not the Obsidian source
 * itself, which is closed) was chosen over rolling a docking manager.
 */
export function Workbench({ components, onReady, rightHeaderActionsComponent }: WorkbenchProps): React.ReactElement {
  return (
    <div className="h-full w-full">
      <DockviewReact
        theme={themeAbyss}
        components={components}
        defaultTabComponent={OrionTab}
        onReady={onReady}
        rightHeaderActionsComponent={rightHeaderActionsComponent}
      />
    </div>
  );
}
