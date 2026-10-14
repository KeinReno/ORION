/**
 * A section view = ONE tab of a section panel (Финансы → «Счета», Дом → «Коммуналка», …) opened as a panel
 * of its own: a dock tab or an OS window. It is identified by a single dock panel id,
 * `view:<base>~<view>[~<instance>]`:
 *
 *  - `base`     the id of the section panel in `panel-registry` (`finance`, `home`, `project`, …);
 *  - `view`     the tab id inside that panel;
 *  - `instance` optional record the section is about (a project id, a home id).
 *
 * The dock already knows how to open, restore and detach `kind:instance` ids (`view` is an instanced
 * kind), so nothing else is needed to make every tab reachable the same way — the section panel
 * itself renders locked to that tab (see `useSectionView`).
 */
export const SECTION_VIEW_KIND = "view";

const PART = /^[A-Za-z0-9_-]+$/;
const SEPARATOR = "~";

export interface SectionViewRef {
  base: string;
  view: string;
  instance?: string;
}

function valid(ref: SectionViewRef): boolean {
  return PART.test(ref.base) && PART.test(ref.view) && (ref.instance === undefined || PART.test(ref.instance));
}

/** The `instanceId` half of the panel id (what the dock stores in `params.instanceId`); null if any part is unusable. */
export function sectionViewInstanceId(ref: SectionViewRef): string | null {
  if (!valid(ref)) return null;
  return [ref.base, ref.view, ...(ref.instance ? [ref.instance] : [])].join(SEPARATOR);
}

/** The full dock panel id; null if any part is unusable. */
export function sectionViewPanelId(ref: SectionViewRef): string | null {
  const instance = sectionViewInstanceId(ref);
  return instance === null ? null : `${SECTION_VIEW_KIND}:${instance}`;
}

/** Reads a `params.instanceId` back into its parts; null for anything that is not a well-formed section view. */
export function parseSectionViewInstance(raw: string | null | undefined): SectionViewRef | null {
  if (!raw) return null;
  const parts = raw.split(SEPARATOR);
  if (parts.length < 2 || parts.length > 3) return null;
  const [base, view, instance] = parts;
  const ref: SectionViewRef = instance === undefined ? { base, view } : { base, view, instance };
  return valid(ref) ? ref : null;
}

export interface SectionViewParams {
  instanceId?: string;
  /** Set by the section view host: render only this tab, without the tab strip. */
  view?: string;
  locked?: boolean;
}

/**
 * Which tab a locked section panel must show. `missing` = it was asked to be locked to a tab that does
 * not exist here any more (a plugin was switched off): the panel shows an explanation, not a wrong tab.
 */
export function resolveLockedView<T extends string>(
  params: SectionViewParams | undefined,
  available: readonly T[]
): { locked: boolean; view: T | null; missing: boolean } {
  const locked = params?.locked === true && typeof params.view === "string";
  if (!locked) return { locked: false, view: null, missing: false };
  const view = available.find((value) => value === params?.view) ?? null;
  return { locked: true, view, missing: view === null };
}
