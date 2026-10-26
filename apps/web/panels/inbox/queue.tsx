"use client";

import type { InboxItem, OrionModuleId } from "@orion/shared-types";
import { isTypingTarget, useMotionSpring, usePanelVisible } from "@orion/ui";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { groupInboxItems, type InboxGroupBy } from "./group";
import { InboxFocus, InboxQueueRow, type ProcessKind } from "./item-card";

type CardHandlers = {
  projectNames: Map<string, string>;
  isEnabled: (id: OrionModuleId) => boolean;
  processPending: boolean;
  onProcessToday: (item: InboxItem) => void;
  onOpenProcess: (item: InboxItem, kind: ProcessKind) => void;
  onDelete: (item: InboxItem) => void;
};

/**
 * Inbox as a triage desk, not a card deck: one thought in front, the rest
 * as a quiet list. Fake stacked paper is gone — remaining count lives in
 * type, not in overlapping frames.
 */
export function InboxQueue({
  items,
  groupBy,
  projectNames,
  isEnabled,
  processPending,
  onProcessToday,
  onOpenProcess,
  onDelete
}: {
  items: InboxItem[];
  groupBy: InboxGroupBy;
  projectNames: Map<string, string>;
  isEnabled: (id: OrionModuleId) => boolean;
  processPending: boolean;
  onProcessToday: (item: InboxItem) => void;
  onOpenProcess: (item: InboxItem, kind: ProcessKind) => void;
  onDelete: (item: InboxItem) => void;
}): React.ReactElement {
  const panelVisible = usePanelVisible();
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = items.find((item) => item.id === focusId) ?? items[0];
  const groups = groupInboxItems(items, groupBy, projectNames);
  const grouped = groupBy !== "none";
  const index = items.findIndex((item) => item.id === focus.id);
  const position = index >= 0 ? index + 1 : 1;

  useEffect(() => {
    if (focusId && !items.some((item) => item.id === focusId)) setFocusId(null);
  }, [items, focusId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || isTypingTarget(event.target)) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      const next = items[Math.max(0, Math.min(items.length - 1, index + dir))];
      if (next) setFocusId(next.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelVisible, items, index]);

  const handlers: CardHandlers = {
    projectNames,
    isEnabled,
    processPending,
    onProcessToday,
    onOpenProcess,
    onDelete
  };

  const smooth = useMotionSpring("smooth");
  return (
    <div className="mx-auto w-full max-w-2xl">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={focus.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={smooth}
        >
          <InboxFocus item={focus} index={position} total={items.length} {...handlers} />
        </motion.div>
      </AnimatePresence>

      {items.length > 1 ? (
        <div className="mt-7 border-t border-border/70 pt-5">
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-body font-medium text-foreground">Дальше в очереди</h2>
            <span className="text-label tabular-nums text-subtle-foreground">{items.length - 1}</span>
          </div>
          {grouped ? (
            <div className="space-y-4">
              {groups.map((group) => {
                const rows = group.items.filter((item) => item.id !== focus.id);
                if (rows.length === 0) return null;
                return (
                  <section key={group.key}>
                    <h3 className="px-3 text-label font-medium text-muted-foreground">
                      {group.label}
                      <span className="ml-2 text-micro font-normal text-subtle-foreground">{rows.length}</span>
                    </h3>
                    <ul>
                      {rows.map((item) => (
                        <li key={item.id}>
                          <InboxQueueRow item={item} active={false} onSelect={() => setFocusId(item.id)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : (
            <ul>
              {items
                .filter((item) => item.id !== focus.id)
                .map((item) => (
                  <li key={item.id}>
                    <InboxQueueRow item={item} active={false} onSelect={() => setFocusId(item.id)} />
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
