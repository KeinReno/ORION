import type { Transition } from "framer-motion";

/**
 * Shared spring presets (docs/UI_UX_DESIGN.md). Instant controls
 * (CheckToggle, Switch, status flash) vs slower chrome (sidebar, sheet-like
 * layout). Keep these two — local stiffness/damping recreates the old
 * "every component feels slightly different" problem.
 */
export const SPRING_SNAP: Transition = { type: "spring", stiffness: 400, damping: 30 };
export const SPRING_SMOOTH: Transition = { type: "spring", stiffness: 200, damping: 25 };
