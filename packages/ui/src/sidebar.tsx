"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { ChevronDown, MoreHorizontal, PanelLeft, PanelLeftClose } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "./hooks";
import { SPRING_SMOOTH } from "./motion";
import { DropdownMenu, type MenuItem } from "./overlays";

export interface SidebarLinkItem {
  /**
   * Both are optional so a module can be either a routed page (`href`,
   * navigated via `LinkComponent`) or a panel that opens/focuses in the
   * Workbench dock (`onClick`, no navigation). Since v0.5 modules use
   * `onClick`; `href` stays supported for anything still route-based.
   */
  href?: string;
  onClick?: () => void;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** For onClick-based items, since there's no href to compare against pathname. */
  isActive?: boolean;
  /** Optional count/indicator (e.g. overdue tasks) — chip when expanded, dot when collapsed. */
  badge?: number;
  /** Screen-reader / tooltip text for the badge, e.g. «просрочено». */
  badgeLabel?: string;
  /**
   * Section this link belongs to, e.g. "Работа" / "Деньги и склад". Items
   * without a group render first, ungrouped, in their original order (the
   * "Сегодня" cluster — Dashboard, Inbox — that every session starts from).
   * Grouping only affects the expanded rail/drawer: the collapsed icon-only
   * rail stays one flat column, since there's no room for section labels
   * there anyway and the whole point of collapsed is "just the icons".
   */
  group?: string;
  /**
   * U06 (24-CONNECTED-CORE-BACKLOG.md) — native HTML5 drag source, so the
   * link can be dragged straight onto Dockview to open it as a tab (drop on
   * a group's center) or split the dock (drop on an edge); dockview's own
   * built-in drop-zone overlay handles the visual feedback on the target
   * side (see `packages/ui/src/workbench.tsx`), this only needs to start a
   * drag carrying the right payload. Absent = link isn't draggable — every
   * caller in this codebase sets it for panel links, never for plain routed
   * pages (`href`-only items have nothing dockview could place).
   */
  onDragStart?: (event: React.DragEvent<HTMLElement>) => void;
  /**
   * Non-mouse alternative to drag for the same destinations drag reaches
   * (split next to the current tab, open in a new window) — U06's done
   * criterion "альтернативы меню/клавиатурой": a plain click already opens
   * the panel (focus-or-create), this menu covers the rest. A small
   * kebab button next to the label, reachable by Tab and opened with
   * Enter/Space, using the existing `DropdownMenu` primitive (Escape to
   * close, click-outside to close — already keyboard-complete). Only
   * renders once the rail is expanded (mirrors the badge/label, which are
   * `sr-only` while collapsed too — the collapsed rail stays icon-only).
   */
  menuItems?: MenuItem[];
}

export interface SidebarLinkComponentProps {
  href: string;
  className?: string;
  children: ReactNode;
  /** Wired up to the collapsed-rail hover label — see `Sidebar`'s `handleEnter`/`handleLeave`. */
  onMouseEnter?: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: () => void;
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur?: () => void;
}

export interface SidebarRenderApi {
  /** Whether the rail is currently expanded (pinned, or the always-expanded drawer). */
  open: boolean;
}

export interface SidebarProps {
  /** Registry of modules: each module contributes one entry here. */
  links: SidebarLinkItem[];
  activeHref?: string;
  /**
   * Optional brand / workspace block pinned to the top. A function gets
   * `{ open }` so it can swap to an icon-only layout while the rail is
   * collapsed — a plain node otherwise renders unconditionally and will
   * overflow the 72px rail (that used to happen to the footer's email +
   * logout text before this existed).
   */
  header?: ReactNode | ((api: SidebarRenderApi) => ReactNode);
  footer?: ReactNode | ((api: SidebarRenderApi) => ReactNode);
  /** Inject the host app's router link (e.g. next/link) for client-side nav. Defaults to a plain <a>. */
  LinkComponent?: ComponentType<SidebarLinkComponentProps>;
  /**
   * `rail` is the desktop hover-expand strip. `drawer` is the phone overlay:
   * always labelled, slides in from the left, closed by default.
   */
  variant?: "rail" | "drawer";
  drawerOpen?: boolean;
  onDrawerClose?: () => void;
}

function DefaultLink({
  href,
  className,
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur
}: SidebarLinkComponentProps): React.ReactElement {
  return (
    <a href={href} className={className} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onFocus={onFocus} onBlur={onBlur}>
      {children}
    </a>
  );
}

/**
 * Compact icon rail, part of the ORION base, not a module. Expands only
 * when explicitly pinned (the toggle button at the bottom) — it used to
 * also expand on hover/keyboard-focus, which read as the sidebar randomly
 * opening and closing on its own; that auto-expand is gone by request, the
 * rail now only ever changes width when the user clicks the pin.
 */
export function Sidebar({
  links,
  activeHref,
  header,
  footer,
  LinkComponent = DefaultLink,
  variant = "rail",
  drawerOpen = false,
  onDrawerClose
}: SidebarProps): React.ReactElement {
  const [pinned, setPinned] = useState(false);
  const isDrawer = variant === "drawer";
  const open = isDrawer || pinned;
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.2;
  const mounted = useMounted();

  // Collapsed-rail hover label ("dock" style) — a floating tag next to the
  // hovered icon, not the whole-rail auto-expand this component used to do
  // (see the doc comment above; that's staying gone). `open` is already
  // true for the drawer and the pinned rail, where the label is inline —
  // `handleEnter`/`handleFocus` no-op in that case so this state simply never sets.
  const [hovered, setHovered] = useState<{ id: string; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  // Which section headers are folded shut — starts empty (every section
  // open) rather than persisted: this is a "tidy the view for a second",
  // not a preference worth remembering across sessions.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  function toggleGroup(name: string): void {
    setCollapsedGroups((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleEnter(id: string, event: React.MouseEvent<HTMLElement>): void {
    if (open) return;
    const target = event.currentTarget;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered({ id, rect: target.getBoundingClientRect() }), 250);
  }
  function handleFocus(id: string, event: React.FocusEvent<HTMLElement>): void {
    if (open) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered({ id, rect: event.currentTarget.getBoundingClientRect() });
  }
  function handleLeave(): void {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(null);
  }
  const hoveredLink = hovered ? links.find((l) => l.label === hovered.id) : undefined;

  function handleNavigate(onClick?: () => void): void {
    onClick?.();
    if (isDrawer) onDrawerClose?.();
  }

  function renderLink(link: SidebarLinkItem): React.ReactElement {
    const Icon = link.icon;
    const isActive = link.isActive ?? link.href === activeHref;
    const className = clsx(
      "group relative flex items-center gap-3 rounded-lg px-3 text-sm transition-colors",
      isDrawer ? "min-h-11 py-2.5" : "py-2",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
      isActive ? "text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
    );
    const ariaLabel = link.badge
      ? `${link.label}, ${link.badgeLabel ?? String(link.badge)}`
      : link.label;
    const content = (
      <>
        {isActive ? (
          <motion.span
            layoutId={isDrawer ? "orion-sidebar-pill-drawer" : "orion-sidebar-pill"}
            className="absolute inset-0 rounded-lg bg-accent/12"
            transition={reduceMotion ? { duration: 0 } : SPRING_SMOOTH}
            aria-hidden
          />
        ) : null}
        {isActive ? (
          <motion.span
            layoutId={isDrawer ? "orion-sidebar-bar-drawer" : "orion-sidebar-bar"}
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent"
            transition={reduceMotion ? { duration: 0 } : SPRING_SMOOTH}
            aria-hidden
          />
        ) : null}
        <motion.span
          className="relative shrink-0"
          whileHover={{ scale: reduceMotion ? 1 : 1.12 }}
          transition={reduceMotion ? { duration: 0 } : SPRING_SMOOTH}
        >
          <Icon className="h-5 w-5" aria-hidden />
          {!open && link.badge ? (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-background" />
          ) : null}
        </motion.span>
        <span className={clsx("flex flex-1 items-center gap-2 overflow-hidden whitespace-nowrap", !open && "sr-only")}>
          <span className="flex-1">{link.label}</span>
          {link.badge ? (
            <span
              title={link.badgeLabel}
              className="rounded-full bg-accent/15 px-1.5 py-0.5 text-2xs font-medium text-accent"
            >
              {link.badge}
            </span>
          ) : null}
        </span>
      </>
    );

    if (link.href) {
      return (
        <LinkComponent
          key={link.label}
          href={link.href}
          className={className}
          onMouseEnter={(e) => handleEnter(link.label, e)}
          onMouseLeave={handleLeave}
          onFocus={(e) => handleFocus(link.label, e)}
          onBlur={handleLeave}
        >
          {content}
        </LinkComponent>
      );
    }

    const button = (
      <button
        key={link.label}
        type="button"
        aria-label={ariaLabel}
        draggable={Boolean(link.onDragStart)}
        onDragStart={link.onDragStart}
        onClick={() => handleNavigate(link.onClick)}
        onMouseEnter={(e) => handleEnter(link.label, e)}
        onMouseLeave={handleLeave}
        onFocus={(e) => handleFocus(link.label, e)}
        onBlur={handleLeave}
        className={clsx(className, "flex-1")}
      >
        {content}
      </button>
    );

    // The kebab menu only makes sense once the label is visible (it opens a
    // menu of text commands) and only needs to exist when the caller
    // actually gave commands to show — most `href` route links never pass
    // `menuItems`, only panel links do (wired in apps/web/app/(app)/layout.tsx).
    if (!link.menuItems || !open) return button;

    return (
      <div key={link.label} className="group/row flex items-center gap-0.5">
        {button}
        <DropdownMenu
          align="end"
          items={link.menuItems}
          trigger={({ toggle }) => (
            <button
              type="button"
              aria-label={`Ещё действия: ${link.label}`}
              onClick={toggle}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtle-foreground opacity-0 transition-opacity hover:bg-white/5 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover/row:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          )}
        />
      </div>
    );
  }

  // Grouping only matters once labels are visible — the collapsed rail stays
  // one flat icon column regardless of `group`. Groups render in the order
  // their first member first appears in `links`; items without a `group`
  // ("Сегодня": Dashboard, Inbox) come first, ungrouped, above every section.
  const ungrouped = links.filter((l) => !l.group);
  const groupOrder: string[] = [];
  for (const link of links) {
    if (link.group && !groupOrder.includes(link.group)) groupOrder.push(link.group);
  }
  const grouped = open && groupOrder.length > 0;

  return (
    <motion.aside
      initial={false}
      animate={isDrawer ? { x: drawerOpen ? 0 : "-100%" } : { width: open ? 240 : 60 }}
      transition={{ duration, ease: "easeInOut" }}
      aria-hidden={isDrawer && !drawerOpen}
      className={clsx(
        "z-40 flex h-dvh shrink-0 flex-col justify-between overflow-hidden border-r border-border px-2.5 py-4",
        // The drawer floats over page content (phone overlay) — glass reads
        // there; the desktop rail sits flush in the flex layout with nothing
        // ever behind it, so it stays flat like the rest of the shell.
        isDrawer ? "fixed inset-y-0 left-0 w-60 bg-background/85 shadow-2xl shadow-black/40 backdrop-blur-xl" : "bg-background"
      )}
      style={isDrawer ? { width: 240, pointerEvents: drawerOpen ? "auto" : "none" } : undefined}
    >
      <div className="flex flex-col gap-3">
        {header ? <div className="px-1">{typeof header === "function" ? header({ open }) : header}</div> : null}
        <nav id="orion-sidebar-nav" aria-label="Разделы" className="flex flex-col gap-1">
          {!grouped
            ? links.map(renderLink)
            : [
                ...ungrouped.map(renderLink),
                ungrouped.length > 0 ? <div key="__sep" className="my-1 h-px bg-border" aria-hidden /> : null,
                ...groupOrder.map((groupName) => {
                  const items = links.filter((l) => l.group === groupName);
                  const isCollapsed = collapsedGroups.has(groupName);
                  return (
                    <div key={groupName} className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupName)}
                        aria-expanded={!isCollapsed}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-2xs font-medium uppercase tracking-wide text-subtle-foreground transition-colors hover:text-foreground"
                      >
                        <motion.span
                          animate={{ rotate: isCollapsed ? -90 : 0 }}
                          transition={{ duration: reduceMotion ? 0 : 0.15 }}
                          className="flex h-3 w-3 shrink-0 items-center justify-center"
                        >
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        </motion.span>
                        {groupName}
                      </button>
                      {!isCollapsed ? (
                        // The connecting "branch" line — a thin border the group's own
                        // rows sit against, so the tree structure reads even without
                        // per-row indentation eating into the label width.
                        <div className="ml-[19px] flex flex-col gap-1 border-l border-border pl-2">
                          {items.map(renderLink)}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ]}
        </nav>
      </div>
      <div className="flex flex-col gap-2">
        {footer ? (
          <div className="border-t border-border pt-3">{typeof footer === "function" ? footer({ open }) : footer}</div>
        ) : null}
        {isDrawer ? (
          <button
            type="button"
            aria-label="Закрыть меню"
            onClick={onDrawerClose}
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden />
            <span>Закрыть</span>
          </button>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls="orion-sidebar-nav"
            aria-label={pinned ? "Открепить меню" : "Закрепить меню"}
            title={pinned ? "Открепить меню" : "Закрепить меню"}
            onClick={() => setPinned((value) => !value)}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {pinned ? <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden /> : <PanelLeft className="h-5 w-5 shrink-0" aria-hidden />}
            <span className={clsx("whitespace-nowrap", !open && "sr-only")}>{pinned ? "Открепить" : "Закрепить"}</span>
          </button>
        )}
      </div>
      {mounted && hovered && hoveredLink
        ? createPortal(
            <AnimatePresence>
              <motion.div
                key={hovered.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: reduceMotion ? 0 : 0.12 }}
                style={{
                  position: "fixed",
                  left: hovered.rect.right + 8,
                  top: hovered.rect.top + hovered.rect.height / 2,
                  transform: "translateY(-50%)"
                }}
                className="pointer-events-none z-[130] flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-xs text-foreground shadow-xl shadow-black/40 backdrop-blur-md"
              >
                {hoveredLink.label}
                {hoveredLink.badge ? (
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-2xs font-medium text-accent">
                    {hoveredLink.badge}
                  </span>
                ) : null}
              </motion.div>
            </AnimatePresence>,
            document.body
          )
        : null}
    </motion.aside>
  );
}
