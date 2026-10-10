"use client";

import { useEffect, useState } from "react";

/**
 * Compass runs on the user's own computer (default http://127.0.0.1:8765) and protects its API with a session cookie
 * that only its own window gets — so ORION never calls that API. All ORION does is say whether something answers at
 * the address, and open it. «Answers» is the public `/api/health` (the one route without the cookie), asked in
 * `no-cors` mode: the browser tells us only that a response arrived, which is exactly the question.
 */

const KEY = "orion.compass.url";
export const DEFAULT_COMPASS_URL = "http://127.0.0.1:8765";

/** A local http address only: ORION must not be turned into a way to probe arbitrary hosts. */
export function normalizeCompassUrl(input: string): string | null {
  try {
    const url = new URL(input.trim().match(/^[a-z]+:\/\//i) ? input.trim() : `http://${input.trim()}`);
    if (url.protocol !== "http:") return null;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function readCompassUrl(): string {
  try {
    return normalizeCompassUrl(localStorage.getItem(KEY) ?? "") ?? DEFAULT_COMPASS_URL;
  } catch {
    return DEFAULT_COMPASS_URL;
  }
}

export function saveCompassUrl(url: string): void {
  try {
    localStorage.setItem(KEY, url);
  } catch {
    /* a convenience only */
  }
}

export type CompassState = "checking" | "running" | "offline";

export function useCompassStatus(url: string): { state: CompassState; recheck: () => void } {
  const [state, setState] = useState<CompassState>("checking");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    setState("checking");
    fetch(`${url}/api/health`, { mode: "no-cors", signal: controller.signal, cache: "no-store" })
      .then(() => setState("running"))
      .catch(() => setState("offline"))
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, nonce]);
  return { state, recheck: () => setNonce((n) => n + 1) };
}

/** `?market=…&symbol=…` — the deep link ORION builds; Compass opens at its start screen until it reads these. */
export function compassInstrumentLink(base: string, market: string, symbol: string): string {
  return `${base}/?${new URLSearchParams({ market, symbol }).toString()}`;
}
