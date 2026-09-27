"use client";

import { ShaderCanvas } from "./shader-canvas";
import type { WebglBackgroundEffectProps } from "./liquid-ether";

/**
 * A grid of shapes displaced by interfering sine waves — reactbits' "Shape
 * Waves". `gap` shrinks each shape away from its cell edge, `waveAmplitude`
 * scales how much the interference pattern swells/shrinks the shapes, and
 * `shape` switches between a circle (distance field) and a square (Chebyshev
 * distance) mark.
 */
const FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uColor;
  uniform float uSpeed;
  uniform float uDensity;
  uniform float uOpacity;
  uniform float uGap;
  uniform float uWaveAmplitude;
  uniform float uShape;

  void main() {
    vec2 uv = vUv;
    uv.x *= uResolution.x / uResolution.y;
    float t = uTime * uSpeed;

    float cells = 14.0 * uDensity;
    vec2 grid = fract(uv * cells) - 0.5;
    vec2 cellId = floor(uv * cells);

    float wave = sin(cellId.x * 0.6 + t) + sin(cellId.y * 0.6 - t * 0.8) + sin((cellId.x + cellId.y) * 0.4 + t * 1.3);
    wave = (wave / 3.0) * uWaveAmplitude;

    float radius = (0.12 + 0.10 * (0.5 + 0.5 * wave)) * (1.0 - uGap);
    float dist = mix(length(grid), max(abs(grid.x), abs(grid.y)), uShape);
    float shapeMask = 1.0 - smoothstep(radius, radius + 0.03, dist);

    float brightness = 0.4 + 0.6 * (0.5 + 0.5 * wave);
    vec3 col = uColor * brightness;
    float alpha = shapeMask * brightness * uOpacity;

    gl_FragColor = vec4(col, alpha);
  }
`;

export interface ShapeWavesProps extends WebglBackgroundEffectProps {
  gap: number;
  waveAmplitude: number;
  shape: "circle" | "square";
}

export default function ShapeWaves({ color, speed, density, opacity, gap, waveAmplitude, shape, className }: ShapeWavesProps): React.ReactElement {
  return (
    <ShaderCanvas
      fragment={FRAGMENT}
      color={color}
      speed={speed}
      density={density}
      opacity={opacity}
      className={className}
      extraUniforms={() => ({
        uGap: { value: gap },
        uWaveAmplitude: { value: waveAmplitude },
        uShape: { value: shape === "square" ? 1 : 0 }
      })}
      extraValues={{ uGap: gap, uWaveAmplitude: waveAmplitude, uShape: shape === "square" ? 1 : 0 }}
    />
  );
}
