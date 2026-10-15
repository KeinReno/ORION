"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "./hooks";
import { useThemeScopeProps } from "./theme-provider";

/**
 * Hover/focus label popped above the trigger — same proven shape as the
 * sidebar's collapsed-rail hover label (`sidebar.tsx`: `createPortal` +
 * `useMounted` + a show-delay on hover, instant on focus, instant hide), now
 * pulled out as a reusable wrapper since a second place needs it (avatars).
 * The sidebar keeps its own copy — it positions to the side of a fixed-width
 * rail, a different enough geometry that sharing this one isn't a clean fit,
 * and it's already shipped; not worth the risk of touching it for this.
 */
export function Tooltip({
  label,
  children,
  delay = 250
}: {
  label: ReactNode;
  children: ReactNode;
  delay?: number;
}): React.ReactElement {
  const mounted = useMounted();
  const themeScope = useThemeScopeProps();
  const reduceMotion = useReducedMotion();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function show(target: HTMLElement, immediate = false): void {
    if (timer.current) clearTimeout(timer.current);
    if (immediate) {
      setRect(target.getBoundingClientRect());
      return;
    }
    timer.current = setTimeout(() => setRect(target.getBoundingClientRect()), delay);
  }
  function hide(): void {
    if (timer.current) clearTimeout(timer.current);
    setRect(null);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget, true)}
      onBlur={hide}
    >
      {children}
      {mounted && rect
        ? createPortal(
            <AnimatePresence>
              <motion.div
                {...themeScope}
                role="tooltip"
                initial={{ opacity: 0, y: 4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.9 }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
                style={{
                  ...themeScope.style,
                  position: "fixed",
                  left: rect.left + rect.width / 2,
                  top: rect.top - 8,
                  transform: "translate(-50%, -100%)"
                }}
                className="pointer-events-none z-[140] whitespace-nowrap rounded-lg border border-ui-overlay-border bg-ui-overlay/95 px-2.5 py-1.5 text-xs text-ui-primary shadow-xl shadow-black/40 backdrop-blur-md"
              >
                {label}
              </motion.div>
            </AnimatePresence>,
            document.body
          )
        : null}
    </span>
  );
}
