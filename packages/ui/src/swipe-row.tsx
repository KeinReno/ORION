"use client";

import clsx from "clsx";
import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { useRef, useState, type ComponentType, type ReactNode } from "react";

export interface SwipeRowAction {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  tone?: "default" | "danger";
}

const ACTION_WIDTH = 68;

/**
 * Swipe-left-to-reveal actions behind a row, for the list rows whose only
 * way to reach a per-item action was a `group-hover:opacity-100` button
 * (see Lists, Documents, Notes, Tasks) — real on desktop, invisible on a
 * touchscreen, since there's no `:hover` there. This is the touch side of
 * that pair: `children` keeps whatever hover/focus button it already had for
 * mouse and keyboard, this adds a drag gesture on top for touch. Not a
 * replacement for the existing affordance, a second path to the same
 * actions.
 *
 * Deliberately simpler than a full swipe-to-delete library: one direction
 * (left, revealing actions on the right — RTL isn't a concern, ORION is
 * Russian-only per CLAUDE.md), no leap/haptics, just drag-reveal-and-tap.
 */
export function SwipeRow({
  actions,
  children,
  className
}: {
  actions: SwipeRowAction[];
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const revealWidth = actions.length * ACTION_WIDTH;
  const x = useMotionValue(0);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);

  function settle(toOpen: boolean): void {
    openRef.current = toOpen;
    setOpen(toOpen);
    animate(x, toOpen ? -revealWidth : 0, reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 42 });
  }

  if (actions.length === 0) return <div className={className}>{children}</div>;

  return (
    <div className={clsx("group relative overflow-hidden rounded-lg", className)}>
      <div className="absolute inset-y-0 right-0 flex" style={{ width: revealWidth }} aria-hidden={!open}>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                action.onSelect();
                settle(false);
              }}
              style={{ width: ACTION_WIDTH }}
              className={clsx(
                "flex h-full flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors",
                action.tone === "danger" ? "bg-destructive/15 text-destructive hover:bg-destructive/25" : "bg-white/[0.06] text-muted-foreground hover:bg-white/10"
              )}
            >
              <Icon className="h-4 w-4" />
              {action.label}
            </button>
          );
        })}
      </div>
      <motion.div
        drag={reduceMotion || actions.length === 0 ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: -revealWidth, right: 0 }}
        dragElastic={0.06}
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={(_event, info) => {
          const shouldOpen = info.offset.x < -revealWidth * 0.4 || info.velocity.x < -400;
          settle(shouldOpen);
        }}
        onClickCapture={(event) => {
          // The first tap while open just closes the drawer instead of
          // triggering whatever the row itself does on click (open file,
          // navigate, etc.) — same "tap elsewhere to dismiss" rule a real
          // swipe-actions row uses everywhere.
          if (openRef.current) {
            event.preventDefault();
            event.stopPropagation();
            settle(false);
          }
        }}
        className="relative z-10 isolate bg-panel orion-opaque-on-glass"
      >
        {children}
      </motion.div>
    </div>
  );
}
