"use client";

import { MotionConfig, useReducedMotion, type Transition } from "framer-motion";
import { createContext, useContext, type ReactNode } from "react";

/**
 * How much the interface moves — the user's «Анимации» setting. `off`: nothing animates;
 * `calm` (default): the same motions, critically damped, so nothing overshoots during a long
 * working session; `expressive`: a little bounce plus the decorative extras (StarBorder, the
 * liquid in SloshGauge). The OS "reduce motion" switch always wins: on such a device the level
 * is `off` whatever the account says.
 */
export type MotionLevel = "off" | "calm" | "expressive";

const MotionLevelContext = createContext<MotionLevel>("calm");

export function MotionLevelProvider({ level, children }: { level: MotionLevel; children: ReactNode }): React.ReactElement {
  // "always" makes framer-motion skip transforms/layout animations everywhere below, including
  // components that don't read the level themselves.
  return (
    <MotionLevelContext.Provider value={level}>
      <MotionConfig reducedMotion={level === "off" ? "always" : "user"}>{children}</MotionConfig>
    </MotionLevelContext.Provider>
  );
}

/** The level that actually applies on this device: the setting, lowered to `off` by the OS switch. */
export function useMotionLevel(): MotionLevel {
  const level = useContext(MotionLevelContext);
  const systemReduce = useReducedMotion();
  return systemReduce ? "off" : level;
}

const INSTANT: Transition = { duration: 0 };

/**
 * Spring presets per level. "snap" — instant controls (check, switch, status, segment pill);
 * "smooth" — slower chrome (sidebar, queues). Calm is critically damped (damping = 2·√stiffness),
 * expressive keeps a short overshoot. Components take these instead of local stiffness/damping.
 */
const SPRINGS: Record<Exclude<MotionLevel, "off">, Record<"snap" | "smooth", Transition>> = {
  calm: {
    snap: { type: "spring", stiffness: 400, damping: 40 },
    smooth: { type: "spring", stiffness: 200, damping: 29 }
  },
  expressive: {
    snap: { type: "spring", stiffness: 420, damping: 22 },
    smooth: { type: "spring", stiffness: 210, damping: 18 }
  }
};

export function useMotionSpring(kind: "snap" | "smooth"): Transition {
  const level = useMotionLevel();
  return level === "off" ? INSTANT : SPRINGS[level][kind];
}
