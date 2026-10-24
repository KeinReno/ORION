import type { MobileRemoteClient } from "@orion/mobile-core";
/** Foreground only. Never imports phone-local records or switches workspace policy. */
export function startForegroundSync(client: Pick<MobileRemoteClient, "engine" | "sync">, options: { active: () => boolean; blocked: () => boolean; error: (message: string) => void }) {
  let stopped = false, running = false;
  let queued: ReturnType<typeof setTimeout> | undefined;
  let flight: Promise<void> | undefined;
  let pending = client.engine.pending().map(({op}) => op.opId).join(",");
  const tick = () => {
    if (stopped || running || !options.active() || options.blocked() || client.engine.status().phase === "revoked") return;
    running = true;
    flight = (async () => {
    try { await client.sync(); if (!stopped) options.error(""); }
    catch { if (!stopped) options.error("Не удалось завершить обмен. Изменения остаются в локальной копии; повторим при наличии связи."); }
    finally { running = false; }
    })();
  };
  const wake = (delay = 0) => { if (stopped) return; clearTimeout(queued); queued = setTimeout(() => { void tick(); }, delay); };
  const unsubscribe = client.engine.subscribe(() => {
    const next = client.engine.pending().map(({op}) => op.opId).join(",");
    if (next !== pending) { pending = next; if (next) wake(650); }
  });
  const timer = setInterval(() => { void tick(); }, 15_000);
  wake();
  return { wake, stop: () => { stopped = true; clearTimeout(queued); clearInterval(timer); unsubscribe(); return flight ?? Promise.resolve(); } };
}
