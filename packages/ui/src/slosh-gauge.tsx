"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useId } from "react";
import { useMotionLevel, useMotionSpring } from "./motion-level";

/** One period of a gentle wave, repeated twice so sliding it by one width loops seamlessly. */
function wavePath(width: number, amplitude: number): string {
  const half = width / 2;
  let d = `M0 0`;
  for (let i = 0; i < 4; i += 1) {
    const x = i * half;
    d += ` Q${x + half / 2} ${i % 2 === 0 ? -amplitude : amplitude} ${x + half} 0`;
  }
  return `${d} V${width * 2} H0 Z`;
}

/**
 * A round gauge filled with liquid up to `value` percent — the one expressive progress widget
 * (a goal on the dashboard). The exact number is always printed in the middle: the liquid is
 * the mood, the number is the fact. Unknown progress (`null`) shows an empty gauge and «—»,
 * never an invented level. The surface sways only at the expressive level; calm keeps a still
 * wave that settles to the new level; off draws the level at once.
 */
export function SloshGauge({
  value,
  size = 88,
  label,
  className
}: {
  value: number | null;
  size?: number;
  /** Accessible name: «Прогресс цели „…“». */
  label: string;
  className?: string;
}): React.ReactElement {
  const level = useMotionLevel();
  const smooth = useMotionSpring("smooth");
  const clipId = useId();
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const surfaceY = size * (1 - clamped / 100);
  const amplitude = clamped === 0 || clamped === 100 ? 0 : size * 0.045;
  const sway = level === "expressive";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? "прогресс неизвестен" : `${value}%`}
      className={clsx("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0">
        <defs>
          <clipPath id={clipId}>
            <circle cx={size / 2} cy={size / 2} r={size / 2 - 2} />
          </clipPath>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} className="fill-white/[0.03] stroke-border" strokeWidth={1.5} />
        {value !== null ? (
          <g clipPath={`url(#${clipId})`}>
            <motion.g initial={false} animate={{ y: surfaceY }} transition={smooth}>
              <motion.path
                d={wavePath(size, amplitude)}
                className="fill-accent/25"
                animate={sway ? { x: [-size, 0] } : { x: -size / 2 }}
                transition={sway ? { duration: 4.2, repeat: Infinity, ease: "linear" } : { duration: 0 }}
              />
              <motion.path
                d={wavePath(size, amplitude * 0.8)}
                className="fill-accent/45"
                animate={sway ? { x: [0, -size] } : { x: 0 }}
                transition={sway ? { duration: 2.8, repeat: Infinity, ease: "linear" } : { duration: 0 }}
              />
            </motion.g>
          </g>
        ) : null}
      </svg>
      <span className="relative font-mono text-sm font-medium tabular-nums text-foreground">{value === null ? "—" : `${value}%`}</span>
    </div>
  );
}
