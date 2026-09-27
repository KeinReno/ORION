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
 * `measure` caps line length so short cards and prose don't stretch with the
 * dock. Header stays full-bleed; calendar / kanban / tables omit this on
 * purpose — their width *is* the data.
 */
export function PanelBody({
  children,
  className,
  measure
}: {
  children: ReactNode;
  className?: string;
  /** `feed` ≈ 36rem (inbox). `prose` ≈ 42rem (dashboard, habits, time). */
  measure?: "feed" | "prose";
}): React.ReactElement {
  return (
    <div
      className={clsx(
        "orion-scroll relative z-10 flex-1 space-y-6 overflow-y-auto p-6",
        measure === "feed" && "max-w-xl",
        measure === "prose" && "max-w-2xl",
        className
      )}
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
        "relative z-20 shrink-0 border-b border-border bg-panel/80 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-panel/60",
        className
      )}
    >
      {/* flex-wrap: when title + actions don't fit (phone, narrow docked
          panel) the actions move under the title instead of overflowing
          the header's right edge. */}
      <div className="flex min-h-8 flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-48 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-muted-foreground">
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            {/* Two lines, then an ellipsis — a single-line truncate cut
                «Добрый день, Мария Волкова» to «Добрый день, Мар» on a phone. */}
            <h1 className="line-clamp-2 break-words text-display text-foreground">{title}</h1>
            {subtitle ? <p className="mt-0.5 truncate text-label text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
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
