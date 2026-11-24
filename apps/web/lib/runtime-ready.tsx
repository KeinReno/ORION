"use client";

import { useEffect } from "react";
import { LOCAL_API_URL } from "./orion-edition";

/** Desktop payload trial: acknowledge root hydration. The native shell owns rollback/reload. */
export function RuntimeReady(): null {
  useEffect(() => {
    const tag = process.env.NEXT_PUBLIC_ORION_BUILD_TAG;
    if (!tag || !["tauri:", "http:", "https:"].includes(location.protocol) || !["localhost", "tauri.localhost"].includes(location.hostname)) return;
    let stopped = false;
    let checking = false;
    let acknowledged = false;
    const tick = async (): Promise<void> => {
      if (checking || acknowledged) return;
      checking = true;
      try {
        const response = await fetch(`${LOCAL_API_URL}/updates/ui-ready`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag }), signal: AbortSignal.timeout(3000) });
        if (response.ok) {
          const result: { accepted?: boolean } = await response.json();
          if (result?.accepted === true && !stopped) acknowledged = true;
        }
      } catch { /* API may still be starting or rolling back. */ }
      finally { checking = false; }
    };
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    const deadline = setTimeout(() => clearInterval(timer), 180_000);
    return () => { stopped = true; clearInterval(timer); clearTimeout(deadline); };
  }, []);
  return null;
}
