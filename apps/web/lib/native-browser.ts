export interface BrowserArea { x: number; y: number; width: number; height: number }

/** CSS pixels; a hidden/offscreen dock panel must never leave a native surface over another panel. */
export function browserArea(rect: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }): BrowserArea | null {
  const x = Math.max(0, rect.left), y = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.left + rect.width), bottom = Math.min(viewport.height, rect.top + rect.height);
  if (![x, y, right, bottom].every(Number.isFinite) || right - x < 2 || bottom - y < 2) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Respect scroll/clip ancestors as well as the window; a dock's title bar must stay above its page. */
export function visibleBrowserArea(element: HTMLElement): BrowserArea | null {
  const rect = element.getBoundingClientRect();
  let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clip = parent.getBoundingClientRect();
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
  }
  return browserArea({ left, top, width: right - left, height: bottom - top }, { width: innerWidth, height: innerHeight });
}
