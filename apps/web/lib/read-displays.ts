import { isTauri } from "./is-tauri";
import { displayFromWorkArea, type DisplayArea } from "./display-geometry";

interface MonitorLike {
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
  workArea?: {
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

function fromMonitor(monitor: MonitorLike): DisplayArea | null {
  const work = monitor.workArea;
  const position = work?.position ?? (typeof work?.x === "number" ? { x: work.x, y: work.y ?? 0 } : monitor.position);
  const size = work?.size ?? (typeof work?.width === "number" ? { width: work.width, height: work.height ?? 0 } : monitor.size);
  return displayFromWorkArea(position, size, monitor.scaleFactor);
}

function browserDisplay(): DisplayArea {
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    x: typeof screen.availLeft === "number" ? screen.availLeft : 0,
    y: typeof screen.availTop === "number" ? screen.availTop : 0,
    width: screen.availWidth,
    height: screen.availHeight,
    scaleFactor: window.devicePixelRatio || 1
  };
}

/** Every connected monitor in Tauri. A browser only knows the screen the window is on. */
export async function readDisplays(): Promise<DisplayArea[]> {
  if (typeof window === "undefined") return [];
  if (!isTauri()) return [browserDisplay()];
  try {
    const { availableMonitors } = await import("@tauri-apps/api/window");
    const monitors = await availableMonitors();
    const displays = monitors.flatMap((monitor) => {
      const display = fromMonitor(monitor as MonitorLike);
      return display ? [display] : [];
    });
    return displays.length > 0 ? displays : [browserDisplay()];
  } catch {
    return [browserDisplay()];
  }
}
