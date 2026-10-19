"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionLevel } from "./motion-level";

/**
 * A point of light travelling along the border of its child — only while something is actually
 * happening (`active`: the assistant is answering, a goal was just reached), so the light keeps
 * its meaning instead of becoming wallpaper. Calm runs slower; with animations off nothing is
 * drawn at all. `className` must carry the child's corner radius (e.g. `rounded-2xl`) so the
 * light follows the same curve.
 */
export function StarBorder({ active, children, className }: { active: boolean; children: ReactNode; className?: string }): React.ReactElement {
  const level = useMotionLevel();
  const on = active && level !== "off";
  return (
    <div className={clsx("relative", className)}>
      {children}
      {on ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-px overflow-hidden p-px"
          style={{
            borderRadius: "inherit",
            // Only the 1px ring between the padding box and the content box shows the light.
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)"
          }}
        >
          <motion.span
            className="absolute left-1/2 top-1/2 aspect-square w-[300%]"
            // Centring goes through framer's own x/y: a Tailwind translate would be overwritten by the rotation's transform.
            style={{ x: "-50%", y: "-50%", background: "conic-gradient(from 0deg, transparent 0 78%, rgb(var(--orion-accent) / 0.9) 90%, transparent 100%)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: level === "expressive" ? 2.4 : 3.8, repeat: Infinity, ease: "linear" }}
          />
        </span>
      ) : null}
    </div>
  );
}
