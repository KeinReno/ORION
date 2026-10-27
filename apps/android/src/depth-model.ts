/** Shared screen-space parallax. Never rotate separate cards around separate cameras. */
export function depthOffset(x: number, y: number, strength: number) {
  const intensity = Number.isFinite(strength) ? Math.max(0, Math.min(100, strength)) / 100 : 0;
  const axis = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value * 1.5)) : 0;
  // Foreground including its card and text stays inside a 4px motion budget.
  return { x: axis(x) * 2 * intensity, y: axis(y) * 2 * intensity };
}
