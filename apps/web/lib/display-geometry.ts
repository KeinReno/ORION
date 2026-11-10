/**
 * Work area of one monitor in the same CSS pixels as `window.screenX`.
 * The origin may be negative when the display sits left of or above the primary.
 * `scaleFactor` is that monitor's own DPI scale (1 = 100%, 1.5 = 150%).
 */
export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

/** A DPI-aware native monitor identity that avoids comparing mixed-DPI global origins. */
export function monitorIdentity(monitor: {
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
} | null | undefined): string | null {
  if (!monitor || ![monitor.position?.x, monitor.position?.y, monitor.size?.width, monitor.size?.height, monitor.scaleFactor].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return `${monitor.position.x}:${monitor.position.y}:${monitor.size.width}:${monitor.size.height}:${monitor.scaleFactor}`;
}

/** Index of the connected display containing this point, or -1 when off screen. */
export function displayIndexAtPoint(x: number, y: number, displays: readonly DisplayArea[]): number {
  return displays.findIndex((display) => x >= display.x && y >= display.y && x < display.x + display.width && y < display.y + display.height);
}

/** True only when the center points of two windows belong to distinct monitors. */
export function windowsOnDifferentDisplays(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
  displays: readonly DisplayArea[]
): boolean {
  const firstDisplay = displayIndexAtPoint(first.x + first.width / 2, first.y + first.height / 2, displays);
  const secondDisplay = displayIndexAtPoint(second.x + second.width / 2, second.y + second.height / 2, displays);
  return firstDisplay >= 0 && secondDisplay >= 0 && firstDisplay !== secondDisplay;
}

/** Preserve an explicit unknown state when display geometry cannot identify either window. */
export function windowDisplayRelation(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
  displays: readonly DisplayArea[]
): "same" | "different" | "unknown" {
  const firstDisplay = displayIndexAtPoint(first.x + first.width / 2, first.y + first.height / 2, displays);
  const secondDisplay = displayIndexAtPoint(second.x + second.width / 2, second.y + second.height / 2, displays);
  if (firstDisplay < 0 || secondDisplay < 0) return "unknown";
  return firstDisplay === secondDisplay ? "same" : "different";
}

/** Tauri reports physical pixels. Divide by this monitor's scale to reach CSS pixels. */
export function displayFromWorkArea(
  position: { x: number; y: number },
  size: { width: number; height: number },
  scaleFactor: number
): DisplayArea | null {
  const scale = scaleFactor > 0 && Number.isFinite(scaleFactor) ? scaleFactor : 1;
  const width = size.width / scale;
  const height = size.height / scale;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !(width > 0) || !(height > 0)) return null;
  return { x: position.x / scale, y: position.y / scale, width, height, scaleFactor: scale };
}

function anchorInside(rect: { x: number; y: number; width: number; height: number }, display: DisplayArea): boolean {
  const x = rect.x + rect.width / 2;
  const y = rect.y + Math.min(rect.height / 2, 48);
  return x >= display.x && y >= display.y && x < display.x + display.width && y < display.y + display.height;
}

/**
 * A saved window whose center is on a connected display stays where it was,
 * including a negative origin. A display that was unplugged sends the window
 * onto the nearest remaining work area.
 */
export function restoreOnDisplays<T extends { x: number; y: number; width: number; height: number }>(
  rect: T,
  displays: readonly DisplayArea[]
): T {
  if (displays.length === 0 || displays.some((display) => anchorInside(rect, display))) return rect;
  const nearest = [...displays].sort((left, right) => {
    const leftDistance = Math.hypot(rect.x - left.x, rect.y - left.y);
    const rightDistance = Math.hypot(rect.x - right.x, rect.y - right.y);
    return leftDistance - rightDistance;
  })[0]!;
  const width = Math.min(rect.width, nearest.width);
  const height = Math.min(rect.height, nearest.height);
  const x = Math.min(Math.max(rect.x, nearest.x), nearest.x + nearest.width - width);
  const y = Math.min(Math.max(rect.y, nearest.y), nearest.y + nearest.height - height);
  return { ...rect, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Beside the host, on a display that is actually connected. A full right edge uses the left side or another monitor. */
export function placeBesideDisplays(
  host: { x: number; y: number; width: number; height: number },
  displays: readonly DisplayArea[]
): { x: number; y: number; width: number; height: number } {
  const width = 280;
  const height = Math.max(480, Math.min(820, host.height > 0 ? host.height : 820));
  const gap = 16;
  const candidates = [
    { x: Math.round(host.x + host.width + gap), y: Math.round(host.y), width, height },
    { x: Math.round(host.x - width - gap), y: Math.round(host.y), width, height }
  ];
  for (const candidate of candidates) {
    if (displays.length === 0 || displays.some((display) => anchorInside(candidate, display))) return candidate;
  }
  const hostCenter = host.x + host.width / 2;
  const other = displays.find((display) => hostCenter < display.x || hostCenter >= display.x + display.width);
  if (other) return restoreOnDisplays({ x: other.x + 24, y: other.y + 24, width, height }, displays);
  return restoreOnDisplays(candidates[0]!, displays);
}
