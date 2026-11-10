"use client";

import { IconButton } from "@orion/ui";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { openPanel } from "../lib/panel-bus";
import { FeedbackButton } from "./feedback-dialog";
import { NotificationBell } from "./notification-bell";

/**
 * Один общий угол окна для настроек и обратной связи — виден всегда, независимо от того,
 * сколько сплитов открыто в доке. Раньше своя кнопка настроек была внутри action-бара каждой
 * группы вкладок (`HeaderActions` в layout.tsx) — при сплите их становилось несколько сразу.
 */
export function GlobalCorner({ children }: { children?: ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-10 shrink-0 items-center justify-end px-3">
      <div className="orion-transport flex max-w-full flex-wrap items-center justify-end gap-1 rounded-lg border border-border bg-card p-1 shadow-lg shadow-black/20">
        {children}
        <NotificationBell />
        <FeedbackButton />
        <IconButton label="Настройки" onClick={() => openPanel("settings")}>
          <Settings className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
