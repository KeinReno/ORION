"use client";

import { useEffect, useRef } from "react";

/**
 * reactbits' "Target Cursor" — a bracket/reticle that follows the pointer and
 * snaps to hover over interactive elements (anything matching `TARGET_SELECTOR`),
 * corners tightening to the hovered element's box instead of floating free.
 *
 * Pure CSS transforms driven by rAF-throttled pointer tracking, no canvas/WebGL
 * — this one doesn't need `ogl`. Hidden entirely on touch (`pointer: coarse`)
 * since there's no cursor to decorate there.
 */
const TARGET_SELECTOR = "a, button, [role=\"button\"], input, textarea, select, [data-target-cursor]";

export function TargetCursor(): React.ReactElement | null {
  const dotRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const targetRef = useRef<HTMLElement | null>(null);
  const posRef = useRef({ x: -100, y: -100 });

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;

    function onPointerMove(event: PointerEvent): void {
      posRef.current = { x: event.clientX, y: event.clientY };
      const el = document.elementFromPoint(event.clientX, event.clientY);
      targetRef.current = el?.closest<HTMLElement>(TARGET_SELECTOR) ?? null;
    }
    window.addEventListener("pointermove", onPointerMove);

    function tick(): void {
      const dot = dotRef.current;
      const box = boxRef.current;
      const { x, y } = posRef.current;
      if (dot) dot.style.transform = `translate(${x}px, ${y}px)`;
      if (box) {
        const target = targetRef.current;
        if (target) {
          const rect = target.getBoundingClientRect();
          const pad = 6;
          box.style.opacity = "1";
          box.style.width = `${rect.width + pad * 2}px`;
          box.style.height = `${rect.height + pad * 2}px`;
          box.style.transform = `translate(${rect.left - pad}px, ${rect.top - pad}px)`;
        } else {
          box.style.opacity = "0";
          box.style.width = "28px";
          box.style.height = "28px";
          box.style.transform = `translate(${x - 14}px, ${y - 14}px)`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    document.documentElement.classList.add("orion-target-cursor-active");

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(rafRef.current);
      document.documentElement.classList.remove("orion-target-cursor-active");
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="orion-target-cursor-dot" aria-hidden />
      <div ref={boxRef} className="orion-target-cursor-box" aria-hidden />
    </>
  );
}
