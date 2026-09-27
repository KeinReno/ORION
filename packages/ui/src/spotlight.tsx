"use client";

import clsx from "clsx";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import type { MouseEvent, ReactNode } from "react";

export interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Card with a cursor-following radial highlight on its border (Aceternity's
 * "spotlight card" pattern) — same glare technique as `TiltCard` but flat,
 * for content that shouldn't tilt (forms, static hero copy).
 */
export function SpotlightCard({ children, className }: SpotlightCardProps): React.ReactElement {
  const x = useMotionValue(50);
  const y = useMotionValue(50);
  const spotlight = useMotionTemplate`radial-gradient(220px circle at ${x}% ${y}%, rgba(255,255,255,0.12), transparent 70%)`;

  function onMouseMove(event: MouseEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(((event.clientX - rect.left) / rect.width) * 100);
    y.set(((event.clientY - rect.top) / rect.height) * 100);
  }

  return (
    <div
      onMouseMove={onMouseMove}
      className={clsx("relative overflow-hidden rounded-2xl border border-border bg-card p-6", className)}
    >
      <motion.div aria-hidden style={{ background: spotlight }} className="pointer-events-none absolute inset-0" />
      <div className="relative">{children}</div>
    </div>
  );
}
