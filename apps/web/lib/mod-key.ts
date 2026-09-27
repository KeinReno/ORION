/** Modifier chord as shown to the user — ⌘ on Apple, Ctrl elsewhere. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function captureShortcutLabel(): string {
  return isApplePlatform() ? "⌘⇧N" : "Ctrl+Shift+N";
}
