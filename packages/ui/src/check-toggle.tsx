"use client";

import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SPRING_SNAP } from "./motion";

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
  const reduceMotion = useReducedMotion();

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
          "flex h-full w-full shrink-0 items-center justify-center border outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
          shapeClass,
          checked
            ? tone === "success"
              ? "border-success bg-success/20 text-success"
              : "border-accent bg-accent text-accent-foreground"
            : "border-border-strong text-transparent hover:border-accent",
          className
        )}
      >
        <motion.span
          initial={false}
          animate={checked ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : SPRING_SNAP}
          className="flex items-center justify-center"
        >
          <Check className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </motion.span>
      </motion.button>
    </span>
  );
}
