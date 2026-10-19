"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useMotionLevel, useMotionSpring } from "./motion-level";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Sliding on/off switch for boolean preferences (notification toggles,
 * appearance settings) — replaces the raw `<input type="checkbox">` that
 * used to render as the browser's unstyled default in Settings. Not for
 * list multi-select checkboxes (documents grid, subtasks) — those stay
 * native checkboxes, that's the correct affordance there.
 */
export function Switch({ checked, onChange, label, disabled, className }: SwitchProps): React.ReactElement {
  const reduceMotion = useMotionLevel() === "off";
  const snap = useMotionSpring("snap");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
        checked ? "bg-accent" : "bg-white/[0.12]",
        className
      )}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ x: checked ? 16 : 0 }}
        transition={snap}
        className="absolute left-[3px] h-3.5 w-3.5"
      >
        {/*
         * A brief horizontal stretch on the thumb itself (keyed remount, not
         * a persistent animation) — the thumb momentarily elongates toward
         * the direction of travel and springs back round, the same "squish"
         * cue the sliding position spring above is missing on its own.
         */}
        <motion.span
          key={checked ? "on" : "off"}
          initial={reduceMotion ? false : { scaleX: 1.4 }}
          animate={{ scaleX: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
          className="block h-full w-full rounded-full bg-white shadow-sm"
        />
      </motion.span>
    </button>
  );
}
