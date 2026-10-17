"use client";

import { X } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./primitives";

export interface ContextPanelTab {
  id: string;
  label: string;
  /** Small count next to the label (links, files). */
  count?: number;
}

/**
 * Frame of the right-hand context panel (ADR-0014): a header that always names the context, a row of
 * actions, tabs and a body. Presentational only — what the context is and what a tab shows is the
 * shell's business. Tabs follow the WAI-ARIA pattern: arrows move between them, Home/End jump.
 */
export function ContextPanelFrame({
  title,
  subtitle,
  badge,
  actions,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  notice,
  children
}: {
  title: string;
  subtitle?: string;
  /** Short mark next to the title, e.g. «закреплено». */
  badge?: string;
  actions?: ReactNode;
  tabs: ContextPanelTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onClose: () => void;
  /** A one-off message under the header (e.g. «пространство сменилось, закрепление снято»). */
  notice?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onTabChange(target.id);
    tabRefs.current[target.id]?.focus();
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card/60">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="min-w-0 truncate text-sm font-medium text-foreground" title={title}>
              {title}
            </h2>
            {badge ? <span className="shrink-0 rounded-full border border-border px-1.5 text-2xs text-subtle-foreground">{badge}</span> : null}
          </div>
          {subtitle ? (
            <p className="truncate text-2xs text-subtle-foreground" title={subtitle}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Скрыть панель"
            title="Скрыть панель"
            className="flex h-7 w-7 items-center justify-center rounded text-subtle-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      {notice ? <div className="shrink-0 border-b border-border bg-white/[0.03] px-3 py-1.5 text-2xs text-muted-foreground">{notice}</div> : null}
      <div role="tablist" aria-label="Разделы панели" onKeyDown={onKeyDown} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2">
        {tabs.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`ctx-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`ctx-body-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              className={cx(
                "shrink-0 border-b-2 px-2.5 py-1.5 text-xs transition-colors",
                selected ? "border-accent text-foreground" : "border-transparent text-subtle-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.count ? <span className="ml-1 text-subtle-foreground">· {tab.count}</span> : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`ctx-body-${activeTab}`} aria-labelledby={`ctx-tab-${activeTab}`} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
