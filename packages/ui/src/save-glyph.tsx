"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useMotionLevel } from "./motion-level";

export type SaveGlyphState = "saving" | "saved" | "error";

/**
 * The small mark beside a save status: a turning ring while the write is in flight, a check that
 * draws itself once the server confirmed it, an exclamation on failure. It follows the real state
 * only — no invented percentage; the ring turns until the request settles.
 */
export function SaveGlyph({ state, className }: { state: SaveGlyphState; className?: string }): React.ReactElement {
  const still = useMotionLevel() === "off";
  const base = clsx("h-3.5 w-3.5 shrink-0", className);
  if (state === "saving") {
    return (
      <motion.svg
        viewBox="0 0 16 16"
        aria-hidden
        className={base}
        animate={still ? undefined : { rotate: 360 }}
        transition={still ? undefined : { repeat: Infinity, duration: 0.9, ease: "linear" }}
      >
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </motion.svg>
    );
  }
  if (state === "error") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden className={clsx(base, "text-destructive")}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <path d="M8 4.8v3.6M8 10.9v.1" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={clsx(base, "text-success")}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.75" />
      <motion.path
        d="M5.2 8.3l1.9 1.9 3.8-4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: still ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: still ? 0 : 0.3, ease: "easeOut" }}
      />
    </svg>
  );
}
