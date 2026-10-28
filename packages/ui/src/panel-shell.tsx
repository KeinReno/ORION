"use client";

import clsx from "clsx";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";

/**
 * True when this panel is actually on screen. Inactive dockview tabs stay
 * mounted but `display: none`; portal overlays (Sheet/Modal) would otherwise
 * keep painting on top of the panel the user switched to.
 */
const PanelVisibleContext = createContext(true);

export function usePanelVisible(): boolean {
  return useContext(PanelVisibleContext);
}

function isHostDisplayed(node: HTMLElement): boolean {
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function useHostVisible(): [RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const sync = (): void => setVisible(isHostDisplayed(node));
    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(node);
    const intersect = new IntersectionObserver(sync, { threshold: 0 });
    intersect.observe(node);
    return () => {
      resize.disconnect();
      intersect.disconnect();
    };
  }, []);

  return [ref, visible];
}

/**
 * The frame every Workbench panel sits in. Replaces the
 * `flex h-full flex-col gap-6 overflow-y-auto p-8` div that was copy-pasted
 * into each of the four panels — one place now owns the panel rhythm
 * (header height, horizontal padding, ambient glow).
 *
 * `PanelShell` is just the fixed-height column + background; put a
 * `PanelBody` inside for the common single-scroll layout, or lay out your
 * own scroll regions (Notes uses a two-pane master/detail).
 */
export function PanelShell({
  children,
  className,
  glow = false
}: {
  children: ReactNode;
  className?: string;
  /** Ambient accent gradient behind the content — for the dashboard, not data panels. */
  glow?: boolean;
}): React.ReactElement {
  const [hostRef, visible] = useHostVisible();
  return (
    <PanelVisibleContext.Provider value={visible}>
      <div
        ref={hostRef}
        className={clsx("relative flex h-full min-h-0 flex-col overflow-hidden bg-panel text-foreground", className)}
      >
        {glow ? (
          <div
            data-panel-glow
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-0 h-72"
            style={{
              background:
                "radial-gradient(48rem 20rem at 20% -40%, rgba(99,102,241,0.16), transparent 70%), radial-gradient(40rem 18rem at 90% -30%, rgba(139,92,246,0.10), transparent 70%)"
            }}
          />
        ) : null}
        {children}
      </div>
    </PanelVisibleContext.Provider>
  );
}

/**
 * The scrolling content region for the common single-column panel.
 *
 * `measure` caps content width by the *kind of work* (see «Контракт ширины»
 * in docs/HISTORY.md), so short cards and prose don't stretch with the
 * dock. Header stays full-bleed; calendar / kanban / tables / Gantt omit it on
 * purpose — their width *is* the data. Don't hand-write `max-w-*` in a panel:
 * pick a step of this scale, so every panel reads at the same widths.
 */
export const PANEL_MEASURE_CLASS = {
  /** ≈ 36rem, left-aligned: a feed of short items (inbox). */
  feed: "max-w-xl",
  /** ≈ 42rem, left-aligned: prose and single-column cards (habits, inventory). */
  prose: "max-w-2xl",
  /** ≈ 64rem, left-aligned: forms and settings sections. */
  settings: "max-w-5xl",
  /** ≈ 72rem, centered: a working area that may split into two columns (time). */
  wide: "mx-auto w-full max-w-6xl"
} as const;

export type PanelMeasure = keyof typeof PANEL_MEASURE_CLASS;

export function PanelBody({
  children,
  className,
  measure,
  onContextMenu
}: {
  children: ReactNode;
  className?: string;
  measure?: PanelMeasure;
  /** ORION-07: a whole-panel right-click fallback (e.g. "Изменить"/"Удалить" the one object a panel shows). */
  onContextMenu?: (event: React.MouseEvent) => void;
}): React.ReactElement {
  return (
    <div
      className={clsx(
        "orion-scroll relative z-10 flex-1 space-y-ui-panel-gap overflow-y-auto p-ui-panel",
        measure && PANEL_MEASURE_CLASS[measure],
        className
      )}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}

/**
 * Sticky panel header: title (+ optional icon and subtitle) on the left,
 * an actions slot on the right, and an optional toolbar row (`children`)
 * underneath for filters / search / view switches.
 */
export function PanelHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <header
      className={clsx(
        "relative z-20 shrink-0 border-b border-ui-border bg-ui-header/80 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-ui-header/60",
        className
      )}
    >
      <div className="flex min-h-8 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 max-w-full flex-auto items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-ui-secondary">
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-display text-ui-primary">{title}</h1>
            {subtitle ? <p className="mt-0.5 truncate text-label text-ui-secondary">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

/** A titled block inside a panel's body. */
export function PanelSection({
  title,
  actions,
  children,
  className
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={clsx("space-y-3", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-micro font-medium uppercase tracking-wide text-subtle-foreground">{title}</h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
