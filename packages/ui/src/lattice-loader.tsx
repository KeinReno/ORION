"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useMotionLevel } from "./motion-level";

const COLS = 4;
const ROWS = 3;

/**
 * For a long wait with no real progress to report (the assistant answering, an import, a
 * report being prepared): a small grid of dots with a glow running across it diagonally, the
 * caller's label and the seconds spent so far. Mount it when the wait starts, unmount when it
 * ends — like MultiStepLoader, its lifetime is the signal. The seconds appear after the first
 * two, so a quick answer never flashes «0 с». With animations off the dots stay still; the
 * label and the counter still tell what is going on.
 */
export function LatticeLoader({ label, className }: { label: string; className?: string }): React.ReactElement {
  const still = useMotionLevel() === "off";
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span role="status" aria-live="polite" className={clsx("inline-flex items-center gap-2.5 text-xs text-muted-foreground", className)}>
      <span aria-hidden className="grid grid-cols-4 gap-[3px]">
        {Array.from({ length: COLS * ROWS }, (_, index) => {
          const diagonal = (index % COLS) + Math.floor(index / COLS);
          return (
            <motion.span
              key={index}
              className="h-1.5 w-1.5 rounded-[2px] bg-accent shadow-[0_0_6px] shadow-accent/70"
              initial={{ opacity: 0.25 }}
              animate={still ? { opacity: 0.45 } : { opacity: [0.2, 1, 0.2], scale: [1, 1.2, 1] }}
              transition={still ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: diagonal * 0.12 }}
            />
          );
        })}
      </span>
      <span>{label}</span>
      {elapsed >= 2 ? <span className="tabular-nums text-subtle-foreground">· {elapsed} с</span> : null}
    </span>
  );
}
