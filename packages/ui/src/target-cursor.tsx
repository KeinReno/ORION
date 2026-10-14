"use client";

import { useEffect, useRef } from "react";

/**
 * reactbits' "Target Cursor", reworked for smoothness: a reticle that wraps the
 * interactive element under the pointer (anything matching `TARGET_SELECTOR`).
 *
 * The pointer itself stays the system cursor. The original version hid it
 * (`cursor: none`) and drew a dot from JavaScript, so the cursor could only move
 * as fast as the page painted — with a WebGL background or a heavy panel that
 * meant a 20-fps pointer. The OS cursor is composited by the system and never
 * waits for the page; the reticle is decoration and may trail a frame.
 *
 * Cheap by construction: the target comes from `pointerover` (no
 * `elementFromPoint` hit-test per move), and the rAF loop runs only while a
 * target is hovered (so the reticle follows scrolling/layout), reading one
 * rect and writing size only when it actually changed. Hidden on touch.
 */
const TARGET_SELECTOR = "a, button, [role=\"button\"], input, textarea, select, [data-target-cursor]";
const PAD = 6;

export function TargetCursor(): React.ReactElement | null {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let target: HTMLElement | null = null;
    let raf = 0;
    let lastW = -1;
    let lastH = -1;

    function place(): void {
      const box = boxRef.current;
      if (!box || !target || !target.isConnected) {
        hide();
        return;
      }
      const rect = target.getBoundingClientRect();
      const width = Math.round(rect.width + PAD * 2);
      const height = Math.round(rect.height + PAD * 2);
      if (width !== lastW || height !== lastH) {
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        lastW = width;
        lastH = height;
      }
      box.style.transform = `translate3d(${rect.left - PAD}px, ${rect.top - PAD}px, 0)`;
      raf = requestAnimationFrame(place);
    }

    function hide(): void {
      cancelAnimationFrame(raf);
      raf = 0;
      target = null;
      if (boxRef.current) boxRef.current.style.opacity = "0";
    }

    function onPointerOver(event: PointerEvent): void {
      if (event.pointerType === "touch") return;
      const next = event.target instanceof Element ? event.target.closest<HTMLElement>(TARGET_SELECTOR) : null;
      if (next === target) return;
      if (!next) {
        hide();
        return;
      }
      target = next;
      if (boxRef.current) boxRef.current.style.opacity = "1";
      if (!raf) raf = requestAnimationFrame(place);
    }

    function onPointerOut(event: PointerEvent): void {
      // Left the window entirely.
      if (!event.relatedTarget) hide();
    }

    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={boxRef} className="orion-target-cursor-box" aria-hidden />;
}
