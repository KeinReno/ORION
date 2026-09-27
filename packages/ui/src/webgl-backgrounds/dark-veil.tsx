"use client";

import { NOISE_GLSL } from "./noise.glsl";
import { ShaderCanvas } from "./shader-canvas";
import type { WebglBackgroundEffectProps } from "./liquid-ether";

/**
 * A slow, mostly-dark drifting fog — reactbits' "Dark Veil". `hueShift`
 * rotates the tint away from `color` over the fog, `warpAmount` controls how
 * much the fbm domain-warps itself (0 = flat drift, 2 = turbulent), and
 * `scanlineIntensity` overlays a faint horizontal scanline texture.
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
  uniform float uHueShift;
  uniform float uWarpAmount;
  uniform float uScanlineIntensity;

  ${NOISE_GLSL}

  vec3 rotateHue(vec3 color, float degrees) {
    const mat3 toYIQ = mat3(0.299, 0.587, 0.114, 0.596, -0.274, -0.322, 0.211, -0.523, 0.312);
    const mat3 toRGB = mat3(1.0, 0.956, 0.621, 1.0, -0.272, -0.647, 1.0, -1.106, 1.703);
    vec3 yiq = toYIQ * color;
    float rad = radians(degrees);
    float cosA = cos(rad);
    float sinA = sin(rad);
    vec2 iq = mat2(cosA, -sinA, sinA, cosA) * yiq.yz;
    return toRGB * vec3(yiq.x, iq);
  }

  void main() {
    vec2 uv = vUv;
    uv.x *= uResolution.x / uResolution.y;
    float t = uTime * uSpeed * 0.04;

    vec2 warp = uWarpAmount * vec2(fbm(uv * 1.2 * uDensity - t * 0.5), fbm(uv * 1.2 * uDensity + t * 0.5));
    float veil = fbm(uv * 1.6 * uDensity + warp + vec2(t, t * 0.3));
    veil = smoothstep(0.2, 0.75, veil);

    vec3 tint = uHueShift > 0.01 ? rotateHue(uColor, uHueShift) : uColor;
    vec3 base = vec3(0.02, 0.02, 0.03);
    vec3 col = mix(base, tint * 0.5, veil * 0.6);

    float scanline = sin(uv.y * uResolution.y * 0.6) * 0.5 + 0.5;
    col = mix(col, col * (0.6 + 0.4 * scanline), uScanlineIntensity);

    float alpha = (0.25 + veil * 0.5) * uOpacity;

    gl_FragColor = vec4(col, alpha);
  }
`;

export interface DarkVeilProps extends WebglBackgroundEffectProps {
  hueShift: number;
  warpAmount: number;
  scanlineIntensity: number;
}

export default function DarkVeil({ color, speed, density, opacity, hueShift, warpAmount, scanlineIntensity, className }: DarkVeilProps): React.ReactElement {
  return (
    <ShaderCanvas
      fragment={FRAGMENT}
      color={color}
      speed={speed}
      density={density}
      opacity={opacity}
      className={className}
      extraUniforms={() => ({
        uHueShift: { value: hueShift },
        uWarpAmount: { value: warpAmount },
        uScanlineIntensity: { value: scanlineIntensity }
      })}
      extraValues={{ uHueShift: hueShift, uWarpAmount: warpAmount, uScanlineIntensity: scanlineIntensity }}
    />
  );
}
