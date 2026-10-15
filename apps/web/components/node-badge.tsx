"use client";

import { useEffect, useState } from "react";
import { fetchClientStatus } from "../lib/lan-local";
import { readNodeMark } from "../lib/node-mode";

const LABEL = { online: "в сети", offline: "узел не в сети", revoked: "доступ отозван", none: "…" } as const;

/**
 * ТЗ-04: в режиме «Клиент LAN» всегда видно, с каким узлом работает окно, и честно показано, если узел недоступен
 * (ввод не теряется: запросы просто не уходят, а в локальную базу ничего не пишется). В «Локальном» режиме не рендерится.
 */
export function NodeBadge(): React.ReactElement | null {
  const [mark] = useState(() => readNodeMark());
  const [link, setLink] = useState<keyof typeof LABEL>("none");
  useEffect(() => {
    if (!mark) return;
    let alive = true;
    const tick = () => void fetchClientStatus().then((status) => alive && setLink(status.link)).catch(() => alive && setLink("offline"));
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [mark]);
  if (!mark) return null;
  const bad = link === "offline" || link === "revoked";
  return (
    <div
      role="status"
      className={`pointer-events-none fixed bottom-2 left-2 z-50 rounded-full border px-3 py-1 text-2xs shadow ${bad ? "border-danger/50 bg-danger/20 text-danger" : "border-white/10 bg-black/60 text-foreground"}`}
    >
      Узел: {mark.name} · {LABEL[link]}
    </div>
  );
}
