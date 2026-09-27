"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion";
import type { MouseEvent, ReactNode } from "react";

export interface TiltCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Single-element perspective tilt effect (Aceternity's Comet/3D Card style).
 * Deliberately not used on list/table rows — see UI discussion: this is for
 * one-off dashboard highlights, not repeated data, to keep lists scannable
 * and fast.
 */
export function TiltCard({ children, className }: TiltCardProps): React.ReactElement {
  const rotateX = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(50);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.15), transparent 60%)`;

  function onMouseMove(event: MouseEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    rotateY.set((px - 0.5) * 14);
    rotateX.set((0.5 - py) * 14);
    glareX.set(px * 100);
    glareY.set(py * 100);
  }

  function onMouseLeave(): void {
    rotateX.set(0);
    rotateY.set(0);
  }

  return (
    <motion.div
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ rotateX, rotateY, transformPerspective: 800 }}
      className={`relative overflow-hidden rounded-2xl border border-border bg-card p-6 ${className ?? ""}`}
    >
      <motion.div style={{ background: glare }} className="pointer-events-none absolute inset-0" />
      <div className="relative">{children}</div>
    </motion.div>
  );
}
