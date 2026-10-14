"use client";

import clsx from "clsx";
import { Program, Mesh, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

/**
 * Shared OGL plumbing for the four full-screen shader backgrounds
 * (liquid-ether, light-pillar, dark-veil, shape-waves) — renderer setup,
 * resize, rAF loop with a shared `uTime`, pointer tracking for the two
 * effects that react to it, and teardown. Each effect only supplies its
 * fragment shader + uniform values; duplicating this per-effect would just
 * be the same fifty lines four times.
 *
 * Respects `prefers-reduced-motion`: still renders one frame (so the effect
 * isn't blank), just doesn't keep animating `uTime`.
 */
export interface ShaderUniforms {
  uColor: { value: [number, number, number] };
  uSpeed: { value: number };
  uDensity: { value: number };
  uOpacity: { value: number };
  [key: string]: { value: unknown };
}

export interface ShaderCanvasProps {
  fragment: string;
  color: [number, number, number];
  speed: number;
  density: number;
  opacity: number;
  /** Initial shape of any per-effect uniforms beyond the shared set — read once at mount. */
  extraUniforms?: () => Record<string, { value: unknown }>;
  /** Live values for those same per-effect uniforms — pushed to the GPU on every change, same as color/speed/density/opacity. */
  extraValues?: Record<string, unknown>;
  trackPointer?: boolean;
  className?: string;
}

/** Internal resolution relative to the device pixels — see the Renderer comment in ShaderCanvas. */
const RENDER_SCALE = 0.5;
/** Background frames per second at most. */
const FRAME_INTERVAL_MS = 1000 / 30;

const VERTEX = `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

export function ShaderCanvas({
  fragment,
  color,
  speed,
  density,
  opacity,
  extraUniforms,
  extraValues,
  trackPointer,
  className
}: ShaderCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniformsRef = useRef<Record<string, { value: unknown }> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // These are soft, full-screen noise fields: rendering them at half the
    // device resolution and letting CSS stretch the canvas is visually the same
    // and a quarter of the fragment work (a sixteenth at DPR 2). Together with
    // the 30 fps cap below this keeps a decorative background from eating the
    // frame budget the UI and the pointer need (measured: liquid-ether alone
    // took a 1600×900 page from 60 to 17 fps).
    const renderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio, 2) * RENDER_SCALE });
    const gl = renderer.gl;
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    container.appendChild(gl.canvas);

    const uniforms: Record<string, { value: unknown }> = {
      uTime: { value: 0 },
      uResolution: { value: [1, 1] },
      uMouse: { value: [0.5, 0.5] },
      uColor: { value: color },
      uSpeed: { value: speed },
      uDensity: { value: density },
      uOpacity: { value: opacity },
      ...(extraUniforms?.() ?? {})
    };
    uniformsRef.current = uniforms;

    const geometry = new Triangle(gl);
    // cullFace: false — OGL's Program defaults to backface culling, and the
    // built-in full-screen Triangle's winding gets culled under that default
    // (a known OGL gotcha for post-process-style shaders), silently leaving
    // the canvas at its clear color with no GL error to explain why.
    const program = new Program(gl, { vertex: VERTEX, fragment, uniforms, transparent: true, cullFace: false });
    const mesh = new Mesh(gl, { geometry, program });

    // Cached so pointer tracking never forces a layout read per move.
    let rect = container.getBoundingClientRect();
    function resize(): void {
      if (!container) return;
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      (uniforms.uResolution.value as number[]) = [clientWidth, clientHeight];
      rect = container.getBoundingClientRect();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    function onPointerMove(event: PointerEvent): void {
      (uniforms.uMouse.value as number[]) = [
        (event.clientX - rect.left) / rect.width,
        1 - (event.clientY - rect.top) / rect.height
      ];
    }
    if (trackPointer) window.addEventListener("pointermove", onPointerMove, { passive: true });

    let raf = 0;
    let last = performance.now();
    function tick(now: number): void {
      raf = requestAnimationFrame(tick);
      // Slow drifting shapes read the same at 30 fps; skip every other frame.
      if (now - last < FRAME_INTERVAL_MS - 1) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!reducedMotion) (uniforms.uTime.value as number) += dt;
      renderer.render({ scene: mesh });
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      if (trackPointer) window.removeEventListener("pointermove", onPointerMove);
      container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shader/trackPointer are fixed per effect, live values are pushed below
  }, [fragment, trackPointer]);

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    (uniforms.uColor.value as number[]) = color;
    uniforms.uSpeed.value = speed;
    uniforms.uDensity.value = density;
    uniforms.uOpacity.value = opacity;
    if (extraValues) {
      for (const key in extraValues) {
        if (uniforms[key]) uniforms[key].value = extraValues[key];
      }
    }
  }, [color, speed, density, opacity, extraValues]);

  // Fills whatever positions it (the fixed inset-0 layer in preferences-effect.tsx) —
  // without this, an empty <div> has no intrinsic height and the canvas inside
  // it (CSS height: 100%, sized in `resize()` above) collapses to whatever the
  // browser resolves a percentage-of-auto height to, not the viewport.
  return <div ref={containerRef} className={clsx("absolute inset-0", className)} />;
}

/** "#7c3aed" → [0.486, 0.231, 0.929]. Falls back to violet on a bad/absent hex. */
export function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return [0.486, 0.231, 0.929];
  const int = parseInt(match[1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}
