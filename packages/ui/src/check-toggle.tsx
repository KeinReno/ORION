"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useMotionLevel, useMotionSpring } from "./motion-level";

export interface CheckToggleProps {
  checked: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
  shape?: "circle" | "square";
  tone?: "accent" | "success";
  className?: string;
}

/**
 * The "mark done" checkbox used everywhere something gets completed (tasks,
 * habits): a spring pop on the checkmark instead of an instant swap, factored
 * out of three near-identical inline buttons (TaskCard, DashboardPanel's
 * TaskRow, habits' TodayRow) so the feel stays consistent as more get added.
 */
export function CheckToggle({
  checked,
  onClick,
  label,
  disabled,
  size = "md",
  shape = "square",
  tone = "accent",
  className
}: CheckToggleProps): React.ReactElement {
  const reduceMotion = useMotionLevel() === "off";
  const snap = useMotionSpring("snap");

  // A one-shot radiating ring on the *transition into* checked (never on
  // uncheck, never on mount) — the checkmark's own spring pop already reads
  // fine on its own, but this is the highest-frequency click in the whole
  // app (tasks, habits, list items, dozens of times a day), so the extra
  // "landed" feedback earns its keep here more than almost anywhere else.
  // Keyed remount is simpler and safer than an imperative animation
  // controller for a fire-and-forget effect like this.
  const [pulseKey, setPulseKey] = useState(0);
  const wasChecked = useRef(checked);
  useEffect(() => {
    if (checked && !wasChecked.current) setPulseKey((k) => k + 1);
    wasChecked.current = checked;
  }, [checked]);

  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-md";

  return (
    <span className={clsx("relative inline-flex shrink-0", size === "sm" ? "h-4 w-4" : "h-5 w-5")}>
      {!reduceMotion && pulseKey > 0 ? (
        <motion.span
          key={pulseKey}
          aria-hidden
          initial={{ scale: 0.7, opacity: 0.5 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className={clsx(
            "pointer-events-none absolute inset-0",
            shapeClass,
            tone === "success" ? "bg-success" : "bg-accent"
          )}
        />
      ) : null}
      <motion.button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        whileTap={reduceMotion ? undefined : { scale: 0.82 }}
        className={clsx(
          "relative flex h-full w-full shrink-0 items-center justify-center overflow-hidden border outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
          shapeClass,
          checked
            ? tone === "success"
              ? "border-success text-success"
              : "border-accent text-accent-foreground"
            : "border-border-strong text-transparent hover:border-accent",
          className
        )}
      >
        {/* The fill grows out of the centre, then the check draws itself over it (Spring Check). */}
        <motion.span
          aria-hidden
          initial={false}
          animate={checked ? { scale: 1, opacity: 1 } : { scale: 0.2, opacity: 0 }}
          transition={snap}
          className={clsx("absolute inset-0", shapeClass, tone === "success" ? "bg-success/20" : "bg-accent")}
        />
        <svg viewBox="0 0 16 16" aria-hidden className={clsx("relative", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")}>
          <motion.path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={checked ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { pathLength: { duration: 0.22, ease: "easeOut", delay: 0.04 }, opacity: { duration: 0.05 } }}
          />
        </svg>
      </motion.button>
    </span>
  );
}

/**
 * A title that gets crossed out when its item is done: the line draws from left to right instead
 * of appearing at once (spring-eased at the expressive level, instant with animations off — see
 * `.orion-strike` in the app's globals.css). Keep it inline inside the row's own (truncating) text box.
 */
export function StrikeText({ done, children, className }: { done: boolean; children: React.ReactNode; className?: string }): React.ReactElement {
  return (
    <span className={clsx("orion-strike", className)} data-done={done ? "true" : undefined}>
      {children}
    </span>
  );
}
