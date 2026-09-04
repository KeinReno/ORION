/** Minimal per-viewer key/value storage — one adapter per platform (web/desktop/mobile). */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** SSR-safe fallback and test double. Never persists across process restarts. */
export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** Browser localStorage — used by both the Next.js web app and the Tauri desktop webview. */
export class BrowserLocalStorage implements KeyValueStorage {
  async get(key: string): Promise<string | null> {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  }
}
