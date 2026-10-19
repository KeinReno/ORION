"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, CircleDashed, CircleDot } from "lucide-react";
import type { ComponentType } from "react";
import { useMotionLevel, useMotionSpring } from "./motion-level";

export type StatusMarkValue = "pending" | "running" | "cancelled";

const ICON: Record<StatusMarkValue, ComponentType<{ className?: string }>> = {
  pending: CircleDashed,
  running: CircleDot,
  cancelled: Ban
};

const TONE: Record<StatusMarkValue, string> = {
  pending: "text-subtle-foreground",
  running: "text-accent-text",
  cancelled: "text-muted-foreground"
};

/**
 * Compact lifecycle glyph, crossfading between states instead of an instant
 * icon swap. Only for the states a plain checkbox can't already tell apart —
 * "done" already has `CheckToggle`'s own filled/checked look, so it isn't
 * one of the values here. First use: `TaskCard` in board views grouped by
 * project or priority, where a todo and an in-progress task otherwise render
 * identically (only status-grouped boards separated them by column).
 */
export function StatusMark({
  status,
  label,
  className
}: {
  status: StatusMarkValue;
  label?: string;
  className?: string;
}): React.ReactElement {
  const reduceMotion = useMotionLevel() === "off";
  const snap = useMotionSpring("snap");
  const Icon = ICON[status];

  return (
    <span className={clsx("relative inline-flex items-center gap-1", TONE[status], className)}>
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
            transition={snap}
            className="flex"
          >
            <Icon className="h-3.5 w-3.5" />
          </motion.span>
        </AnimatePresence>
      </span>
      {label ? <span className="text-2xs font-medium">{label}</span> : null}
    </span>
  );
}
