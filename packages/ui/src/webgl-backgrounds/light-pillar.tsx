"use client";

import { NOISE_GLSL } from "./noise.glsl";
import { ShaderCanvas } from "./shader-canvas";
import type { WebglBackgroundEffectProps } from "./liquid-ether";

/**
 * A vertical volumetric light beam that drifts toward the pointer on the
 * x-axis, reactbits' "Light Pillar" — a soft column with noise-based
 * flicker/rays, dark everywhere else. `pillarWidth`/`rayIntensity`/`flicker`
 * mirror the tunables reactbits exposes for this effect.
 */
const FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform vec3 uColor;
  uniform float uSpeed;
  uniform float uDensity;
  uniform float uOpacity;
  uniform float uPillarWidth;
  uniform float uRayIntensity;
  uniform float uFlicker;

  ${NOISE_GLSL}

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    float t = uTime * uSpeed * 0.3;

    float pillarX = mix(0.5, uMouse.x, 0.6);
    float dx = (uv.x - pillarX) * aspect;

    float flicker = mix(1.0, 0.85 + 0.15 * noise(vec2(t * 2.0, uv.y * 4.0 * uDensity)), uFlicker);
    float core = exp(-pow(dx / uPillarWidth, 2.0));
    float rays = exp(-pow(dx / (uPillarWidth * 4.0), 2.0)) * (0.5 + 0.5 * sin(uv.y * 30.0 * uDensity - t * 4.0));

    float glow = clamp(core * flicker + rays * uRayIntensity, 0.0, 1.0);
    float vertical = smoothstep(0.0, 0.25, uv.y) * smoothstep(1.0, 0.6, uv.y);
    glow *= mix(0.5, 1.0, vertical);

    vec3 col = uColor * glow;
    float alpha = glow * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`;

export interface LightPillarProps extends WebglBackgroundEffectProps {
  pillarWidth: number;
  rayIntensity: number;
  flicker: number;
}

export default function LightPillar({ color, speed, density, opacity, pillarWidth, rayIntensity, flicker, className }: LightPillarProps): React.ReactElement {
  return (
    <ShaderCanvas
      fragment={FRAGMENT}
      color={color}
      speed={speed}
      density={density}
      opacity={opacity}
      trackPointer
      className={className}
      extraUniforms={() => ({
        uPillarWidth: { value: pillarWidth },
        uRayIntensity: { value: rayIntensity },
        uFlicker: { value: flicker }
      })}
      extraValues={{ uPillarWidth: pillarWidth, uRayIntensity: rayIntensity, uFlicker: flicker }}
    />
  );
}
