"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { ChevronDown, Folder, FolderOpen, FolderPlus, MoreHorizontal, PanelLeft, PanelLeftClose } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "./hooks";
import { SPRING_SMOOTH } from "./motion";
import { DropdownMenu, Popover, type MenuItem } from "./overlays";

export interface SidebarLinkItem {
  /** Stable id (the panel id) — what a user folder refers to. Optional: a link without one cannot sit in a folder. */
  id?: string;
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
  menuItems?: (MenuItem | "separator")[];
}

/**
 * A folder the user made. The sidebar only DRAWS it: which links are in it, whether it is
 * folded and what its menu offers are decided by the host (it owns storage and rules).
 */
export interface SidebarFolderView {
  id: string;
  name: string;
  collapsed: boolean;
  /** Ids of the links inside, in order — already limited to links that exist right now. */
  linkIds: string[];
  /** Folder actions (rename, move, delete), shown behind a «⋯» next to the name. */
  menuItems?: (MenuItem | "separator")[];
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
  /** Keep every module icon reachable even when personal folders are collapsed. */
  allIconsVisible?: boolean;
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
  /** The user's own folders. Links named here leave their default place and show inside the folder. */
  folders?: SidebarFolderView[];
  onToggleFolder?: (folderId: string) => void;
  /** Shows a «Новая папка» row at the end of the list when given; `linkId` is set when a link was dropped on it. */
  onCreateFolder?: (linkId?: string) => void;
  /**
   * Drag-and-drop inside the sidebar: link `linkId` was dropped into folder `folderId` (before
   * `beforeId`, or at the end), or out of its folder when `folderId` is null. Enables dragging.
   */
  onMoveLink?: (linkId: string, folderId: string | null, beforeId?: string) => void;
  /** Which window edge the menu sits on. top/bottom make a horizontal icon bar. Ignored for the phone drawer. */
  position?: "left" | "right" | "top" | "bottom";
}

const DRAG_TYPE = "application/x-orion-sidebar-link";

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
  onDrawerClose,
  folders = [],
  onToggleFolder,
  onCreateFolder,
  onMoveLink,
  allIconsVisible = false,
  position = "left"
}: SidebarProps): React.ReactElement {
  const [pinned, setPinned] = useState(false);
  const isDrawer = variant === "drawer";
  const horizontal = !isDrawer && (position === "top" || position === "bottom");
  const open = isDrawer || (pinned && !horizontal);
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

  // The links column scrolls on a short window. In the 60px collapsed rail a
  // scrollbar (Windows draws one with arrow buttons) eats a sixth of the width
  // and pushes the icons off-centre, so there the bar is hidden and a soft
  // fade at the clipped edge says "there is more" instead.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || horizontal) return;
    function measure(): void {
      if (!el) return;
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setClipped((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [horizontal, open]);
  const fadeMask =
    clipped.top || clipped.bottom
      ? `linear-gradient(to bottom, ${clipped.top ? "transparent 0, black 20px" : "black 0"}, ${clipped.bottom ? "black calc(100% - 20px), transparent 100%" : "black 100%"})`
      : undefined;
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

  // Dragging a link onto a folder / between links. `dragId` is set only for a drag that started
  // in this sidebar, so files or dock tabs dragged over it are ignored. `dropKey` marks the target.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  function dropProps(key: string, folderId: string | null, beforeId?: string, onDropped?: (id: string) => void): React.HTMLAttributes<HTMLElement> {
    if (!onMoveLink) return {};
    return {
      onDragOver: (event) => {
        if (!dragId) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        if (dropKey !== key) setDropKey(key);
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropKey((cur) => (cur === key ? null : cur));
      },
      onDrop: (event) => {
        if (!dragId) return;
        event.preventDefault();
        event.stopPropagation();
        const id = dragId;
        setDragId(null);
        setDropKey(null);
        if (onDropped) onDropped(id);
        else onMoveLink(id, folderId, beforeId);
      }
    };
  }

  function handleNavigate(onClick?: () => void): void {
    onClick?.();
    if (isDrawer) onDrawerClose?.();
  }

  function renderLinkBase(link: SidebarLinkItem): React.ReactElement {
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
            className={clsx("absolute rounded-full bg-accent", horizontal ? "inset-x-2 bottom-0 h-0.5" : "inset-y-1.5 left-0 w-0.5")}
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
              className="rounded-full bg-accent/15 px-1.5 py-0.5 text-2xs font-medium text-accent-text"
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
        draggable={Boolean(link.onDragStart) || Boolean(onMoveLink && link.id)}
        onDragStart={(event) => {
          link.onDragStart?.(event);
          if (onMoveLink && link.id) {
            event.dataTransfer.setData(DRAG_TYPE, link.id);
            event.dataTransfer.effectAllowed = "copyMove";
            setDragId(link.id);
          }
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropKey(null);
        }}
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

  /** A link that is also a drop target: dropped here, a dragged link takes this link's place in its folder. */
  function renderLink(link: SidebarLinkItem): React.ReactElement {
    const base = renderLinkBase(link);
    if (!onMoveLink || !link.id) return base;
    const folder = folders.find((f) => f.linkIds.includes(link.id as string));
    const key = `link:${link.id}`;
    return (
      <div
        key={link.label}
        {...dropProps(key, folder?.id ?? null, link.id)}
        className={clsx("rounded-lg", dragId && dragId !== link.id && dropKey === key && "bg-accent/10 ring-1 ring-accent/60")}
      >
        {base}
      </div>
    );
  }

  // Links the user put into a folder leave their default place. Grouping (default sections and
  // folders) only matters once labels are visible — the collapsed rail stays a flat icon column,
  // where each folder is ONE folder icon that opens its links in a small list.
  const inFolder = new Set(folders.flatMap((folder) => folder.linkIds));
  const free = links.filter((l) => !(l.id && inFolder.has(l.id)));
  const ungrouped = free.filter((l) => !l.group);
  const groupOrder: string[] = [];
  for (const link of free) {
    if (link.group && !groupOrder.includes(link.group)) groupOrder.push(link.group);
  }
  const hasSections = groupOrder.length > 0 || folders.length > 0;
  const grouped = open && hasSections;
  const linkById = new Map(links.filter((l) => l.id).map((l) => [l.id as string, l]));
  const iconButtonClass = clsx(
    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
  );

  /** Collapsed rail: one icon for the whole folder; its links open in a popover list. */
  function renderFolderRail(folder: SidebarFolderView): React.ReactElement {
    const members = folder.linkIds.map((id) => linkById.get(id)).filter((l): l is SidebarLinkItem => Boolean(l));
    return (
      <Popover
        key={`folder:${folder.id}`}
        align={position === "right" ? "end" : "start"}
        width={232}
        trigger={({ toggle, open: isOpen, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label={`Папка «${folder.name}», разделов: ${members.length}`}
            title={`${folder.name} · ${members.length}`}
            {...dropProps(`folder:${folder.id}`, folder.id)}
            className={clsx(iconButtonClass, dragId && dropKey === `folder:${folder.id}` && "bg-accent/10 ring-1 ring-accent/60")}
          >
            <span className="relative shrink-0">
              {isOpen ? <FolderOpen className="h-5 w-5" aria-hidden /> : <Folder className="h-5 w-5" aria-hidden />}
              {members.some((m) => m.badge) ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-background" /> : null}
            </span>
          </button>
        )}
      >
        {({ close }) => (
          <div className="p-1.5">
            <p className="px-2 pb-1 pt-0.5 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{folder.name}</p>
            {members.length === 0 ? <p className="px-2 py-1.5 text-label text-subtle-foreground">В папке пока пусто</p> : null}
            {members.map((member) => {
              const MemberIcon = member.icon;
              return (
                <button
                  key={member.id ?? member.label}
                  type="button"
                  onClick={() => {
                    close();
                    handleNavigate(member.onClick);
                  }}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    member.isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MemberIcon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{member.label}</span>
                  {member.badge ? <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-2xs font-medium text-accent-text">{member.badge}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </Popover>
    );
  }

  function renderFolder(folder: SidebarFolderView): React.ReactElement {
    const members = folder.linkIds.map((id) => linkById.get(id)).filter((l): l is SidebarLinkItem => Boolean(l));
    return (
      <div
        key={`folder:${folder.id}`}
        {...dropProps(`folder:${folder.id}`, folder.id)}
        className={clsx("flex flex-col gap-1 rounded-lg", dragId && dropKey === `folder:${folder.id}` && "bg-accent/10 ring-1 ring-accent/60")}
      >
        <div className="group/folder flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onToggleFolder?.(folder.id)}
            aria-expanded={!folder.collapsed}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 py-1 text-2xs font-medium uppercase tracking-wide text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <motion.span
              animate={{ rotate: folder.collapsed ? -90 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.15 }}
              className="flex h-3 w-3 shrink-0 items-center justify-center"
            >
              <ChevronDown className="h-3 w-3" aria-hidden />
            </motion.span>
            {folder.collapsed ? <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
            <span className="shrink-0 font-mono text-2xs normal-case tabular-nums">{members.length}</span>
          </button>
          {folder.menuItems && folder.menuItems.length > 0 ? (
            <DropdownMenu
              align="end"
              items={folder.menuItems}
              trigger={({ toggle }) => (
                <button
                  type="button"
                  aria-label={`Действия с папкой «${folder.name}»`}
                  onClick={toggle}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtle-foreground opacity-0 transition-opacity hover:bg-white/5 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover/folder:opacity-100"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>
              )}
            />
          ) : null}
        </div>
        {!folder.collapsed ? (
          <div className="ml-[19px] flex flex-col gap-1 border-l border-border pl-2">
            {members.length === 0 ? (
              <p className="px-3 py-1 text-2xs text-subtle-foreground">Пусто — добавьте раздел через «⋯» у него в списке</p>
            ) : (
              members.map(renderLink)
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // Collapsed rail: original order, with each folder standing in at the place of its first link.
  function renderRail(): React.ReactNode[] {
    const emitted = new Set<string>();
    const out: React.ReactNode[] = [];
    for (const link of links) {
      const folder = link.id ? folders.find((f) => f.linkIds.includes(link.id as string)) : undefined;
      if (!folder) {
        out.push(renderLink(link));
      } else if (!emitted.has(folder.id)) {
        emitted.add(folder.id);
        out.push(renderFolderRail(folder));
      }
    }
    // A folder with nothing visible in it still gets its icon, after the links.
    for (const folder of folders) if (!emitted.has(folder.id)) out.push(renderFolderRail(folder));
    return out;
  }

  return (
    <motion.aside
      initial={false}
      animate={isDrawer ? { x: drawerOpen ? 0 : "-100%" } : horizontal ? { width: "100%" } : { width: open ? 240 : 60 }}
      transition={{ duration, ease: "easeInOut" }}
      aria-hidden={isDrawer && !drawerOpen}
      className={clsx(
        "z-40 flex shrink-0 justify-between overflow-hidden border-border",
        horizontal ? "h-14 flex-row items-center px-3" : "h-dvh flex-col px-2.5 py-4",
        !horizontal && (position === "right" ? "border-l" : "border-r"),
        horizontal && (position === "top" ? "border-b" : "border-t"),
        // The drawer floats over page content (phone overlay) — glass reads
        // there; the desktop rail sits flush in the flex layout with nothing
        // ever behind it, so it stays flat like the rest of the shell.
        isDrawer ? "fixed inset-y-0 left-0 w-60 bg-background/85 shadow-2xl shadow-black/40 backdrop-blur-xl" : "bg-background"
      )}
      style={isDrawer ? { width: 240, pointerEvents: drawerOpen ? "auto" : "none" } : undefined}
    >
      {/* Vertical: the links scroll on a short window while the footer (account, layouts, widgets) stays pinned. */}
      <div
        ref={scrollRef}
        className={clsx(
          "flex gap-3",
          horizontal ? "min-w-0 flex-1 flex-row items-center" : "min-h-0 flex-col overflow-y-auto overflow-x-hidden",
          !horizontal && (open ? "orion-scroll" : "orion-scroll-hidden")
        )}
        style={!horizontal && fadeMask ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined}
      >
        {header ? <div className="px-1">{typeof header === "function" ? header({ open }) : header}</div> : null}
        <nav
          id="orion-sidebar-nav"
          aria-label="Разделы"
          className={clsx("flex gap-1", horizontal ? "min-w-0 flex-row items-center overflow-x-auto" : "flex-col")}
          {...dropProps("nav", null)}
        >
          {!grouped
            ? allIconsVisible ? links.map(renderLink) : hasSections
              ? renderRail()
              : links.map(renderLink)
            : [
                ...ungrouped.map(renderLink),
                ungrouped.length > 0 ? <div key="__sep" className="my-1 h-px bg-border" aria-hidden /> : null,
                ...folders.map(renderFolder),
                folders.length > 0 && groupOrder.length > 0 ? <div key="__sep2" className="my-1 h-px bg-border" aria-hidden /> : null,
                ...groupOrder.map((groupName) => {
                  const items = free.filter((l) => l.group === groupName);
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
                }),
                onCreateFolder ? (
                  <button
                    key="__new-folder"
                    type="button"
                    onClick={() => onCreateFolder()}
                    {...dropProps("new-folder", null, undefined, (id) => onCreateFolder(id))}
                    className={clsx(
                      "mt-1 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-left text-2xs text-subtle-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                      dragId && dropKey === "new-folder" && "border-accent text-foreground"
                    )}
                  >
                    <FolderPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Новая папка
                  </button>
                ) : null
              ]}
        </nav>
      </div>
      <div className={clsx("flex gap-2", horizontal ? "shrink-0 flex-row items-center" : "shrink-0 flex-col")}>
        {footer ? (
          <div className={horizontal ? "border-l border-border pl-3" : "border-t border-border pt-3"}>{typeof footer === "function" ? footer({ open }) : footer}</div>
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
        ) : horizontal ? null : (
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
                style={
                  position === "right"
                    ? { position: "fixed", left: hovered.rect.left - 8, top: hovered.rect.top + hovered.rect.height / 2, transform: "translate(-100%, -50%)" }
                    : position === "top"
                      ? { position: "fixed", left: hovered.rect.left + hovered.rect.width / 2, top: hovered.rect.bottom + 8, transform: "translateX(-50%)" }
                      : position === "bottom"
                        ? { position: "fixed", left: hovered.rect.left + hovered.rect.width / 2, top: hovered.rect.top - 8, transform: "translate(-50%, -100%)" }
                        : { position: "fixed", left: hovered.rect.right + 8, top: hovered.rect.top + hovered.rect.height / 2, transform: "translateY(-50%)" }
                }
                className="pointer-events-none z-[130] flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-xs text-foreground shadow-xl shadow-black/40 backdrop-blur-md"
              >
                {hoveredLink.label}
                {hoveredLink.badge ? (
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-2xs font-medium text-accent-text">
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
