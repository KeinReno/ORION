import { sameEntityRef, type EntityRef, type OrionModuleId } from "@orion/shared-types";
import type { ResourceContext } from "./extensions/contracts";

/**
 * ADR-0014 — which object or section the right-hand context panel is about. Pure state transitions
 * (no React, no storage) so the rules are tested; `resource-context-store.ts` wires them to React.
 *
 * Priority of what the panel shows: the pinned context, else the object the active panel has
 * published (a selected task, an open note, a project tab), else the active section itself.
 */
export interface PublishedEntity {
  ref: EntityRef;
  title: string;
}

export interface SectionInfo {
  panelId: string;
  moduleId: OrionModuleId | null;
  label: string;
}

export interface ResourceContextState {
  workspaceId: string | null;
  activePanelId: string | null;
  /** The object each dock panel currently has in focus, keyed by dock panel id. */
  published: Readonly<Record<string, PublishedEntity>>;
  pinned: ResourceContext | null;
  /** One-off explanation shown in the panel (e.g. the pin was dropped on a workspace switch). */
  notice: string | null;
}

export const INITIAL_RESOURCE_CONTEXT: ResourceContextState = {
  workspaceId: null,
  activePanelId: null,
  published: {},
  pinned: null,
  notice: null
};

export function setActivePanel(state: ResourceContextState, panelId: string | null): ResourceContextState {
  return state.activePanelId === panelId ? state : { ...state, activePanelId: panelId };
}

/** `entity = null` withdraws the panel's object (selection cleared, panel closed). */
export function publishEntity(state: ResourceContextState, panelId: string, entity: PublishedEntity | null): ResourceContextState {
  const current = state.published[panelId];
  if (!entity) {
    if (!current) return state;
    const rest = Object.fromEntries(Object.entries(state.published).filter(([key]) => key !== panelId));
    return { ...state, published: rest };
  }
  if (current && sameEntityRef(current.ref, entity.ref) && current.title === entity.title) return state;
  return { ...state, published: { ...state.published, [panelId]: entity } };
}

export function resolveContext(state: ResourceContextState, sectionOf: (panelId: string) => SectionInfo | null): ResourceContext | null {
  if (state.pinned) return state.pinned;
  const panelId = state.activePanelId;
  if (!panelId) return null;
  const entity = state.published[panelId];
  const section = sectionOf(panelId);
  // The header reads «Финансы → Счёт «Сбер»»: the section is the panel the object was published from.
  if (entity) return { kind: "entity", ref: entity.ref, title: entity.title, sectionLabel: section?.label ?? "" };
  return section ? { kind: "section", panelId: section.panelId, moduleId: section.moduleId, label: section.label } : null;
}

/** Fixes the context currently on screen; "follow" is unpin. */
export function pinContext(state: ResourceContextState, context: ResourceContext | null): ResourceContextState {
  return context ? { ...state, pinned: context, notice: null } : state;
}

export function unpinContext(state: ResourceContextState): ResourceContextState {
  return state.pinned ? { ...state, pinned: null } : state;
}

/** «Сбросить»: forget the active panel's object (and a pin), go back to the section. */
export function resetContext(state: ResourceContextState): ResourceContextState {
  const next = unpinContext(state);
  return state.activePanelId ? publishEntity(next, state.activePanelId, null) : next;
}

export function dismissNotice(state: ResourceContextState): ResourceContextState {
  return state.notice ? { ...state, notice: null } : state;
}

/**
 * A different workspace is active: nothing about the old one may stay on screen. Objects, the pin and
 * (separately, by the caller) cached queries go; a dropped pin is explained, not silently lost.
 */
export function switchWorkspace(state: ResourceContextState, workspaceId: string | null): ResourceContextState {
  if (state.workspaceId === workspaceId) return state;
  const hadPin = state.pinned !== null && state.workspaceId !== null;
  return {
    ...state,
    workspaceId,
    published: {},
    pinned: null,
    notice: hadPin ? "Пространство сменилось, закрепление снято: панель снова следует за текущим разделом." : null
  };
}

/** Header text: «Финансы → Счёт «Сбер»» for an object, the section name for a section. */
export function contextHeading(context: ResourceContext): { title: string; subtitle: string } {
  if (context.kind === "section") return { title: context.label, subtitle: "Раздел" };
  return { title: context.title || "Без названия", subtitle: context.sectionLabel };
}

export function describeContext(context: ResourceContext, typeLabel?: string): string {
  if (context.kind === "section") return context.label;
  const name = `${typeLabel ? `${typeLabel} ` : ""}«${context.title || "Без названия"}»`;
  return `${context.sectionLabel} → ${name}`;
}

/** React-query roots whose entries belong to one workspace and must not survive leaving it (key[1] = workspaceId). */
export const WORKSPACE_SCOPED_RESOURCE_KEYS: readonly string[] = ["links", "documents", "document-blob", "search"];
