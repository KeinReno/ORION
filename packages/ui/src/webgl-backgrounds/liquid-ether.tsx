"use client";

import { NOISE_GLSL } from "./noise.glsl";
import { hexToRgb, ShaderCanvas } from "./shader-canvas";

/**
 * Slow domain-warped fluid flow, akin to reactbits' "Liquid Ether" — two
 * layers of fbm noise, one warping the other, blended between `color` and
 * `colorSecondary` by the flow field. `autoDemo` off freezes the ambient
 * flow to a slow idle and lets the pointer stir it via `mouseForce`
 * (reactbits' own autoDemo/mouseForce pairing); on, the flow always runs.
 */
const FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform vec3 uColor;
  uniform vec3 uColorSecondary;
  uniform float uSpeed;
  uniform float uDensity;
  uniform float uOpacity;
  uniform float uMouseForce;
  uniform float uAutoDemo;

  ${NOISE_GLSL}

  void main() {
    vec2 uv = vUv;
    uv.x *= uResolution.x / uResolution.y;
    float t = uTime * uSpeed * mix(0.02, 0.08, uAutoDemo);

    vec2 warp = vec2(fbm(uv * 2.2 * uDensity + t), fbm(uv * 2.2 * uDensity - t));

    vec2 mouseUv = uMouse;
    mouseUv.x *= uResolution.x / uResolution.y;
    float mouseDist = length(uv - mouseUv);
    float mouseBump = exp(-mouseDist * mouseDist * 8.0) * uMouseForce;
    warp += mouseBump * 0.6;

    float flow = fbm(uv * 3.0 * uDensity + warp * 1.6 + t * 0.5);
    float glow = smoothstep(0.35, 0.85, flow + mouseBump * 0.3);

    vec3 tint = mix(uColor, uColorSecondary, clamp(warp.x * 0.5 + 0.5, 0.0, 1.0));
    vec3 col = mix(vec3(0.0), tint, glow);
    float alpha = glow * uOpacity;

    gl_FragColor = vec4(col, alpha);
  }
`;

export interface WebglBackgroundEffectProps {
  color: [number, number, number];
  speed: number;
  density: number;
  opacity: number;
  className?: string;
}

export interface LiquidEtherProps extends WebglBackgroundEffectProps {
  colorSecondary: string | null;
  mouseForce: number;
  autoDemo: boolean;
}

export default function LiquidEther({ color, speed, density, opacity, colorSecondary, mouseForce, autoDemo, className }: LiquidEtherProps): React.ReactElement {
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
        uColorSecondary: { value: hexToRgb(colorSecondary) },
        uMouseForce: { value: mouseForce },
        uAutoDemo: { value: autoDemo ? 1 : 0 }
      })}
      extraValues={{ uColorSecondary: hexToRgb(colorSecondary), uMouseForce: mouseForce, uAutoDemo: autoDemo ? 1 : 0 }}
    />
  );
}
