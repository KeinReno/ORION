"use client";

import { entityRefOf, type SearchableEntityType } from "@orion/shared-types";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ResourceContext } from "./extensions/contracts";
import {
  INITIAL_RESOURCE_CONTEXT,
  dismissNotice,
  pinContext,
  publishEntity,
  resetContext,
  resolveContext,
  setActivePanel,
  switchWorkspace,
  unpinContext,
  type ResourceContextState,
  type SectionInfo
} from "./resource-context";
import { usePanelId } from "./unsaved-drafts";

/**
 * React/browser wiring of the context panel's state (ADR-0014). The pure rules live in
 * `resource-context.ts`; this file only holds the module-level store, the visibility/width
 * preferences of this window, and the hooks panels use to say "this object is in focus".
 */

let state: ResourceContextState = INITIAL_RESOURCE_CONTEXT;
const listeners = new Set<() => void>();
/** Set once by the shell: maps a dock panel id to its section (kept out of here to avoid importing every panel). */
let sectionResolver: (panelId: string) => SectionInfo | null = () => null;

function update(next: ResourceContextState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSectionResolver(resolver: (panelId: string) => SectionInfo | null): void {
  sectionResolver = resolver;
  for (const listener of listeners) listener();
}

export const resourceContextActions = {
  setActivePanel: (panelId: string | null) => update(setActivePanel(state, panelId)),
  switchWorkspace: (workspaceId: string | null) => update(switchWorkspace(state, workspaceId)),
  pin: (context: ResourceContext | null) => update(pinContext(state, context)),
  unpin: () => update(unpinContext(state)),
  reset: () => update(resetContext(state)),
  dismissNotice: () => update(dismissNotice(state))
};

/** The state plus the context it resolves to for the panel now on screen. */
export function useResourceContext(): { state: ResourceContextState; context: ResourceContext | null; pinned: boolean } {
  const current = useSyncExternalStore(subscribe, () => state, () => INITIAL_RESOURCE_CONTEXT);
  const context = useMemo(() => resolveContext(current, sectionResolver), [current]);
  return { state: current, context, pinned: current.pinned !== null };
}

/**
 * A panel says which object is in focus (the open note, the selected task, a project tab). It is
 * withdrawn when the object goes away or the panel unmounts, so the context never outlives its source.
 */
export function usePublishResourceContext(entity: { type: SearchableEntityType; id: string; title: string } | null): void {
  const panelId = usePanelId();
  const type = entity?.type;
  const id = entity?.id;
  const title = entity?.title ?? "";
  useEffect(() => {
    if (!panelId || !type || !id) return;
    update(publishEntity(state, panelId, { ref: entityRefOf(type, id), title }));
    return () => update(publishEntity(state, panelId, null));
  }, [panelId, type, id, title]);
}

/**
 * Imperative variant for an explicit «Материалы» action on an object that has no selection state
 * (a finance account): focuses it for `panelId`'s section and opens the panel.
 */
export function showResourcesFor(panelId: string, entity: { type: SearchableEntityType; id: string; title: string }): void {
  update(publishEntity(state, panelId, { ref: entityRefOf(entity.type, entity.id), title: entity.title }));
  setResourcesPanelOpen(true);
}

// ---- visibility and width: per window, never part of the workspace's data ----

const OPEN_KEY = "orion.resources.open";
const WIDTH_KEY = "orion.resources.width";
export const RESOURCES_MIN_WIDTH = 260;
export const RESOURCES_MAX_WIDTH = 560;
export const RESOURCES_DEFAULT_WIDTH = 300;

export function clampResourcesWidth(width: number): number {
  if (!Number.isFinite(width)) return RESOURCES_DEFAULT_WIDTH;
  return Math.min(RESOURCES_MAX_WIDTH, Math.max(RESOURCES_MIN_WIDTH, Math.round(width)));
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the preference lasts for this session only */
  }
}

interface PanelPrefs {
  open: boolean;
  width: number;
  hydrated: boolean;
}
let prefs: PanelPrefs = { open: false, width: RESOURCES_DEFAULT_WIDTH, hydrated: false };
const prefListeners = new Set<() => void>();

function setPrefs(next: PanelPrefs): void {
  prefs = next;
  for (const listener of prefListeners) listener();
}

function hydratePrefs(): void {
  if (prefs.hydrated || typeof window === "undefined") return;
  const storedWidth = Number(readStored(WIDTH_KEY));
  prefs = { open: readStored(OPEN_KEY) === "1", width: storedWidth ? clampResourcesWidth(storedWidth) : RESOURCES_DEFAULT_WIDTH, hydrated: true };
}

export function setResourcesPanelOpen(open: boolean): void {
  hydratePrefs();
  writeStored(OPEN_KEY, open ? "1" : "0");
  setPrefs({ ...prefs, open });
}

export function setResourcesPanelWidth(width: number): void {
  hydratePrefs();
  const next = clampResourcesWidth(width);
  writeStored(WIDTH_KEY, String(next));
  setPrefs({ ...prefs, width: next });
}

export function useResourcesPanelPrefs(): { open: boolean; width: number; toggle: () => void } {
  const current = useSyncExternalStore(
    (listener) => {
      prefListeners.add(listener);
      return () => prefListeners.delete(listener);
    },
    () => {
      hydratePrefs();
      return prefs;
    },
    () => prefs
  );
  const toggle = useCallback(() => setResourcesPanelOpen(!prefs.open), []);
  return { open: current.open, width: current.width, toggle };
}
