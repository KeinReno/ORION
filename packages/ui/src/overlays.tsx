"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { X } from "lucide-react";
import { Fragment, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { usePanelVisible } from "./panel-shell";
import { Button, IconButton, Input } from "./primitives";
import { isTypingTarget, useEscapeKey, useMounted, useOnClickOutside } from "./hooks";
import { computeFocusTrapAction } from "./focus-trap";
import { useThemeScopeProps } from "./theme-provider";
import { useUiSound } from "./sound-level";

/** Portal overlays must not stay on screen after their host panel is hidden. */
function useOverlayOpen(open: boolean): boolean {
  const panelVisible = usePanelVisible();
  return open && panelVisible;
}

/*
 * Nested overlays happen legitimately (a note attachment's preview Modal, or
 * its detach ConfirmDialog, opened while the note editor itself sits inside
 * NotesPanel's mobile Sheet) — see `rule/no-nested-modals` in 04-UX.md: the
 * rule bans a *second modal choice flow* nested inside a modal, not "a Modal
 * can never be a descendant of a Sheet in the DOM". What must never happen is
 * two overlays reacting to the same input at once. Without this, both Modal
 * and Sheet independently `useEscapeKey`/`useFocusTrap` off raw
 * `document`-level listeners: opening a Modal over an already-open Sheet made
 * Escape close *both* in one press, and Tab inside the (topmost) Modal kept
 * getting yanked back into the Sheet's trap, because the Sheet's own
 * `currentOutsideContainer` check saw focus was outside itself and forced it
 * back — a real keyboard-trap bug, not a hypothetical one.
 * This tiny global stack tracks *open* Modal/Sheet instances; only the
 * topmost one gets an active Escape handler / Tab trap, and a covered one
 * disables its own until it is topmost again.
 */
let overlayStack: number[] = [];
let nextOverlayId = 0;
const overlayStackListeners = new Set<() => void>();

function notifyOverlayStack(): void {
  overlayStackListeners.forEach((listener) => listener());
}

/** True while this instance is the top of the Modal/Sheet stack (or the only one open). */
function useTopmostOverlay(open: boolean): boolean {
  const idRef = useRef<number | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!open) return;
    const id = ++nextOverlayId;
    idRef.current = id;
    overlayStack.push(id);
    notifyOverlayStack();
    return () => {
      overlayStack = overlayStack.filter((existing) => existing !== id);
      idRef.current = null;
      notifyOverlayStack();
    };
  }, [open]);

  useEffect(() => {
    function onChange(): void {
      forceRender((n) => n + 1);
    }
    overlayStackListeners.add(onChange);
    return () => {
      overlayStackListeners.delete(onChange);
    };
  }, []);

  return open && idRef.current !== null && overlayStack[overlayStack.length - 1] === idRef.current;
}

/**
 * The element that had focus when the overlay opened, captured DURING THE
 * RENDER in which `shown` flips to true. Reading `document.activeElement`
 * later, in the open effect, was too late: a child with `autoFocus` (the
 * task/event/budget forms' first input) is focused during commit, so the
 * "opener" recorded was that input — gone after close — and focus fell to
 * <body> instead of returning to «Новая задача» (live U12 keyboard pass).
 */
function useOpenerCapture(shown: boolean): React.MutableRefObject<HTMLElement | null> {
  const openerRef = useRef<HTMLElement | null>(null);
  const wasShown = useRef(false);
  if (shown && !wasShown.current && typeof document !== "undefined") {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasShown.current = shown;
  return openerRef;
}

/** Focus the container only if nothing inside it (an autoFocus field) already has focus. */
function focusInto(container: HTMLElement | null): void {
  if (container && !container.contains(document.activeElement)) container.focus();
}

function restoreOpener(el: HTMLElement | null): void {
  if (!el?.isConnected) return;
  // Hidden dockview tabs are display:none — focusing the opener there would
  // steal focus from the panel the user just switched to.
  if (el.getClientRects().length === 0) return;
  el.focus?.();
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => !node.hasAttribute("disabled") && node.getAttribute("aria-hidden") !== "true"
  );
}

/** Keeps Tab cycling inside `ref` while `active`. Restoring the opener is the caller's job. */
function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Tab" || !ref.current) return;
      const nodes = focusableIn(ref.current);
      const current = document.activeElement;
      const action = computeFocusTrapAction({
        nodes,
        current,
        currentOutsideContainer: !ref.current.contains(current),
        shiftKey: event.shiftKey
      });
      if (action.type === "focus-container") {
        event.preventDefault();
        ref.current.focus();
      } else if (action.type === "focus-node") {
        event.preventDefault();
        (action.node as HTMLElement).focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, ref]);
}

function useMotionDuration(full: number): number {
  const reduce = useReducedMotion();
  return reduce ? 0 : full;
}

/** Only the overlay shell owns dismissal. Content layout animations (for example a
 * segmented control's shared pill) must not hold its enclosing presence open.
 * A nested, non-propagating boundary keeps content alive for the shell's exit,
 * then unmounts it with the shell, without waiting for unrelated layout exits. */
function OverlayContents({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <AnimatePresence>
      <Fragment key="content">{children}</Fragment>
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ Modal */

type ModalSize = "sm" | "md" | "lg";

/**
 * Centered dialog. Hand-rolled (no Radix / Headless UI dependency): portal
 * to <body>, backdrop click + Escape to close, body scroll lock, focus
 * moved into the dialog on open and restored to the opener on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  returnFocus = true
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /**
   * Put focus back on the opener when the dialog closes (the default). A launcher whose actions open something
   * else (the command palette) turns it off: focus jumping back would re-activate the dock group the palette was
   * called from, and the next «Открыть рядом» would land beside the wrong panel.
   */
  returnFocus?: boolean;
}): React.ReactElement | null {
  const mounted = useMounted();
  const themeScope = useThemeScopeProps();
  const dialogRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const fade = useMotionDuration(0.13);
  const pop = useMotionDuration(0.14);
  const shown = useOverlayOpen(open);
  const openerRef = useOpenerCapture(shown);
  const isTop = useTopmostOverlay(shown);

  useEscapeKey(onClose, isTop);
  useFocusTrap(dialogRef, isTop);

  useEffect(() => {
    if (!shown) return;
    const opener = openerRef.current;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => focusInto(dialogRef.current));
    return () => {
      document.body.style.overflow = overflow;
      cancelAnimationFrame(raf);
      if (returnFocus) restoreOpener(opener);
    };
  }, [shown, openerRef, returnFocus]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {shown ? (
        <motion.div
          {...themeScope}
          key="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: fade }}
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:p-6"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? labelId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: pop, ease: "easeOut" }}
            className={clsx(
              "relative z-10 my-8 w-full rounded-2xl border border-ui-overlay-border bg-ui-overlay/85 shadow-2xl shadow-black/40 outline-none backdrop-blur-xl",
              size === "sm" && "max-w-sm",
              size === "md" && "max-w-lg",
              size === "lg" && "max-w-2xl"
            )}
          >
            <OverlayContents>
              {title ? (
                <div className="border-b border-ui-overlay-border px-5 py-3.5">
                  <h2 id={labelId} className="text-sm font-semibold text-ui-primary">
                    {title}
                  </h2>
                  {description ? <p className="mt-0.5 text-xs text-ui-secondary">{description}</p> : null}
                </div>
              ) : null}
              <div className="px-5 py-4">{children}</div>
              {footer ? <div className="flex justify-end gap-2 border-t border-ui-overlay-border px-5 py-3.5">{footer}</div> : null}
            </OverlayContents>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/* ------------------------------------------------------------------ Sheet */

/** Slide-over panel anchored to one edge — used for task details. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  width = "28rem",
  bare = false
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** Drop the body's padding + scroll wrapper so the child can own its own layout. */
  bare?: boolean;
}): React.ReactElement | null {
  const mounted = useMounted();
  const themeScope = useThemeScopeProps();
  const panelRef = useRef<HTMLDivElement>(null);
  // Same as Modal: the title names the dialog for screen readers (and for getByRole(..., { name })).
  const labelId = useId();
  const fade = useMotionDuration(0.15);
  const slide = useMotionDuration(0.2);
  const shown = useOverlayOpen(open);
  const openerRef = useOpenerCapture(shown);
  const isTop = useTopmostOverlay(shown);
  useEscapeKey(onClose, isTop);
  useFocusTrap(panelRef, isTop);

  useEffect(() => {
    if (!shown) return;
    const opener = openerRef.current;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => focusInto(panelRef.current));
    return () => {
      document.body.style.overflow = overflow;
      cancelAnimationFrame(raf);
      restoreOpener(opener);
    };
  }, [shown, openerRef]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {shown ? (
        <motion.div
          {...themeScope}
          key="sheet"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: fade }}
          className="fixed inset-0 z-[100] flex justify-end"
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? labelId : undefined}
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: slide, ease: "easeOut" }}
            style={{ width }}
            className="relative z-10 flex h-full max-w-[92vw] flex-col border-l border-ui-overlay-border bg-ui-overlay/90 shadow-2xl shadow-black/50 outline-none backdrop-blur-xl"
          >
            <OverlayContents>
              {title ? (
                <div className="flex items-center justify-between border-b border-ui-overlay-border px-5 py-3.5">
                  <h2 id={labelId} className="text-sm font-semibold text-ui-primary">{title}</h2>
                  <IconButton label="Закрыть" size="sm" onClick={onClose}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
              ) : null}
              {bare ? (
                <div className="flex min-h-0 flex-1 flex-col">{children}</div>
              ) : (
                <div className="orion-scroll flex-1 overflow-y-auto px-5 py-4">{children}</div>
              )}
              {footer ? <div className="flex justify-end gap-2 border-t border-ui-overlay-border px-5 py-3.5">{footer}</div> : null}
            </OverlayContents>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/* ----------------------------------------------------------- DropdownMenu */

export interface MenuItem {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

export function DropdownMenu({
  trigger,
  items,
  align = "end"
}: {
  trigger: (api: { open: boolean; toggle: () => void }) => ReactNode;
  items: (MenuItem | "separator")[];
  align?: "start" | "end";
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  useOnClickOutside(wrapRef, () => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      {trigger({ open, toggle })}
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.12 }}
            className={clsx(
              "absolute top-full z-50 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-border bg-card/90 p-1 shadow-xl shadow-black/40 backdrop-blur-md",
              align === "end" ? "right-0" : "left-0"
            )}
          >
            {items.map((item, index) => {
              if (item === "separator") return <div key={`sep-${index}`} className="my-1 h-px bg-border" />;
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40",
                    item.tone === "danger"
                      ? "text-destructive hover:bg-destructive/10"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                  {item.label}
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- Popover */

/**
 * Fixed-positioned popover measured from its trigger's rect, so it works
 * even when the trigger sits in a tiny clipped box (a calendar day cell).
 * Controlled or uncontrolled.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  open: controlledOpen,
  onOpenChange,
  width = 288,
  backdrop = false
}: {
  trigger: (api: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement> }) => ReactNode;
  children: (api: { close: () => void }) => ReactNode;
  align?: "start" | "end" | "center";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  width?: number;
  /** Click-catcher behind the panel — needed when the popover is as wide as a phone viewport. */
  backdrop?: boolean;
}): React.ReactElement {
  const mounted = useMounted();
  const themeScope = useThemeScopeProps();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({ top: 0, left: 0, width, maxHeight: 480 });

  const shown = useOverlayOpen(open);
  useOnClickOutside([triggerRef, panelRef], () => setOpen(false), shown);
  useEscapeKey(() => setOpen(false), shown);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const boxWidth = Math.min(width, Math.max(200, window.innerWidth - 16));
    const rect = el.getBoundingClientRect();
    let left = rect.left;
    if (align === "end") left = rect.right - boxWidth;
    if (align === "center") left = rect.left + rect.width / 2 - boxWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - boxWidth - 8));
    // Opens below the trigger; near the bottom edge (a menu bar docked at the bottom) it opens above instead.
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 240 && rect.top > spaceBelow) {
      setPos({ bottom: window.innerHeight - rect.top + 6, left, width: boxWidth, maxHeight: Math.max(120, rect.top - 14) });
    } else {
      const top = Math.min(rect.bottom + 6, window.innerHeight - 8);
      setPos({ top, left, width: boxWidth, maxHeight: Math.max(120, window.innerHeight - top - 8) });
    }
  }, [align, width]);

  useEffect(() => {
    if (!shown) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [shown, reposition]);

  return (
    <>
      {trigger({ open, toggle: () => setOpen(!open), ref: triggerRef })}
      {mounted
        ? createPortal(
            <AnimatePresence>
              {shown ? (
                <Fragment key="popover">
                  {backdrop ? (
                    <motion.div
                      key="popover-backdrop"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                      className="fixed inset-0 z-[89] bg-black/40"
                      onClick={() => setOpen(false)}
                    />
                  ) : null}
                  <motion.div
                    {...themeScope}
                    key="popover-panel"
                    ref={panelRef}
                    initial={{ opacity: 0, scale: 0.97, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    style={{
                      ...themeScope.style,
                      position: "fixed",
                      top: pos.top,
                      bottom: pos.bottom,
                      left: pos.left,
                      width: pos.width,
                      maxHeight: pos.maxHeight
                    }}
                    className="z-[90] overflow-y-auto rounded-xl border border-ui-overlay-border bg-ui-overlay/90 p-3 shadow-xl shadow-black/40 backdrop-blur-md"
                  >
                    {children({ close: () => setOpen(false) })}
                  </motion.div>
                </Fragment>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </>
  );
}

/* ------------------------------------------------------------ ContextMenu */

/**
 * ORION-07: one point-anchored menu Orion shows on right-click, instead of
 * the WebView/Edge menu ("Назад", "Обновить", "Печать") that reads as a bug
 * on an Orion surface. `useContextMenu` is the one way a component offers
 * its own items at the pointer; `ContextMenuProvider` (mounted once, e.g. at
 * the Workbench root) owns the single open menu's state.
 *
 * Composition rule — this is the "contextual resolver" from the platform
 * doc, built the cheap way (React bubbling) instead of a global DOM
 * listener plus a separate target-matching registry:
 *  - A handler whose `buildItems` returns items calls `stopPropagation` and
 *    owns the click.
 *  - A handler with nothing to offer does **not** stop propagation, so the
 *    event keeps bubbling to an ancestor's own `useContextMenu` — up to
 *    whatever root fallback the app registered (e.g. "Команды… Ctrl+K").
 *  - An editable surface (`isTypingTarget`) or a live text selection is left
 *    alone everywhere — no `preventDefault` at all — so native copy/paste
 *    and spellcheck keep working exactly as before.
 *  - A caller that must offer its own actions on a selection (format commands
 *    in the note editor) passes `includeTypingTarget` and owns that click.
 */

interface ContextMenuState {
  x: number;
  y: number;
  items: (MenuItem | "separator")[];
}

interface ContextMenuApi {
  show: (x: number, y: number, items: (MenuItem | "separator")[]) => void;
  hide: () => void;
}

const ContextMenuCtx = createContext<ContextMenuApi | null>(null);

/** Native copy/paste/spellcheck stays available for an editable field or a selection the user made to copy. */
function isNativeTextContext(target: EventTarget | null): boolean {
  return isTypingTarget(target) || Boolean(typeof window !== "undefined" && window.getSelection()?.toString());
}

export function ContextMenuProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const hide = useCallback(() => setState(null), []);
  const api = useMemo<ContextMenuApi>(() => ({ show: (x, y, items) => setState({ x, y, items }), hide }), [hide]);
  return (
    <ContextMenuCtx.Provider value={api}>
      {children}
      <ContextMenuSurface state={state} onClose={hide} />
    </ContextMenuCtx.Provider>
  );
}

export interface ContextMenuShowOptions {
  /** Open on a text field or a selection. The caller replaces the native menu for that click. */
  includeTypingTarget?: boolean;
}

/** Shared by `useContextMenu` and `useContextMenuApi` — see their doc comments for the composition rule. */
function runContextMenu(
  api: ContextMenuApi | null,
  event: React.MouseEvent,
  items: (MenuItem | "separator")[] | null,
  options?: ContextMenuShowOptions
): void {
  if (!options?.includeTypingTarget && isNativeTextContext(event.target)) return;
  event.preventDefault();
  if (!items || items.length === 0) return;
  event.stopPropagation();
  api?.show(event.clientX, event.clientY, items);
}

/**
 * Spread the returned `onContextMenu` onto any element. `buildItems` may
 * return `null`/`[]` to decline — the event then bubbles to an ancestor
 * instead of showing an empty menu. Declining still suppresses the native
 * menu (every handler in the chain calls `preventDefault`); only
 * `stopPropagation` is conditional.
 */
export function useContextMenu(
  buildItems: (event: React.MouseEvent) => (MenuItem | "separator")[] | null
): { onContextMenu: (event: React.MouseEvent) => void } {
  const api = useContext(ContextMenuCtx);
  const buildRef = useRef(buildItems);
  buildRef.current = buildItems;
  const onContextMenu = useCallback((event: React.MouseEvent) => runContextMenu(api, event, buildRef.current(event)), [api]);
  return { onContextMenu };
}

/**
 * For a list/grid `.map()`, where a hook can't be called once per row: get
 * this once at the component's top level, then build each row's handler
 * inline — `onContextMenu={(e) => showContextMenu(e, itemsForRow(row))}`.
 * Same decline-to-bubble rule as `useContextMenu`.
 */
export function useContextMenuApi(): (
  event: React.MouseEvent,
  items: (MenuItem | "separator")[] | null,
  options?: ContextMenuShowOptions
) => void {
  const api = useContext(ContextMenuCtx);
  return useCallback(
    (event: React.MouseEvent, items: (MenuItem | "separator")[] | null, options?: ContextMenuShowOptions) =>
      runContextMenu(api, event, items, options),
    [api]
  );
}

function ContextMenuSurface({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }): React.ReactElement | null {
  const mounted = useMounted();
  const themeScope = useThemeScopeProps();
  const panelRef = useRef<HTMLDivElement>(null);
  const open = state !== null;
  const shown = useOverlayOpen(open);
  const isTop = useTopmostOverlay(shown);
  useEscapeKey(onClose, isTop);
  useOnClickOutside([panelRef], onClose, shown);

  // A stale menu floating over content that just scrolled/resized under it reads as broken, not alive.
  useEffect(() => {
    if (!shown) return;
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [shown, onClose]);

  const pos = useMemo(() => {
    if (!state) return { left: 0, top: 0 };
    const width = 224; // estimate before layout — clamped so the menu never opens off-screen
    return {
      left: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(state.y, window.innerHeight - 8))
    };
  }, [state]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {shown && state ? (
        <motion.div
          {...themeScope}
          key="context-menu"
          ref={panelRef}
          role="menu"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.1 }}
          style={{ ...themeScope.style, position: "fixed", left: pos.left, top: pos.top }}
          className="z-[110] min-w-[12rem] overflow-hidden rounded-xl border border-ui-overlay-border bg-ui-overlay/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          {state.items.map((item, index) => {
            if (item === "separator") return <div key={`sep-${index}`} className="my-1 h-px bg-border" />;
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                // Keep a CodeMirror selection: focusing the menu item would collapse it before onSelect.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40",
                  item.tone === "danger"
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                {item.label}
              </button>
            );
          })}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/* --------------------------------------------------------- ConfirmDialog */

/**
 * Small yes/no confirmation on top of Modal — for destructive actions with
 * no undo (there's no restore endpoint for a deleted note or task).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Удалить",
  cancelLabel = "Отмена",
  onConfirm,
  onCancel,
  danger = true,
  confirmDisabled = false
}: {
  open: boolean;
  title: string;
  /** A plain string renders as one line of muted text; pass a node (e.g. with an embedded Input) for a type-to-confirm prompt. */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  /** Disables the confirm button — e.g. until a type-to-confirm field matches. */
  confirmDisabled?: boolean;
}): React.ReactElement {
  // `danger` is used app-wide specifically for "no undo" deletes (see the doc comment above) —
  // one place to sound the confirm, rather than every call site remembering to.
  const { play } = useUiSound();
  function confirm(): void {
    if (danger) play("action.deletePermanent");
    onConfirm();
  }
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={danger ? "danger" : "primary"} size="sm" disabled={confirmDisabled} onClick={confirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Level-3 confirmation: irreversible, high-cost (purge bytes, bulk move).
 * Confirm stays disabled until the user types `phrase` exactly.
 */
export function TypeToConfirmDialog({
  open,
  title,
  description,
  phrase,
  confirmLabel = "Удалить навсегда",
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  phrase: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={typed.trim() !== phrase}
      onConfirm={onConfirm}
      onCancel={onCancel}
      description={
        <div className="space-y-3">
          <div>{description}</div>
          <label className="block space-y-1">
            <span className="text-micro text-subtle-foreground">Введите «{phrase}»</span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={phrase}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
      }
    />
  );
}
