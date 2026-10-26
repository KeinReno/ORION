"use client";

import { IconButton } from "@orion/ui";
import { Settings } from "lucide-react";
import { openPanel } from "../lib/panel-bus";
import { FeedbackButton } from "./feedback-dialog";

/**
 * Один общий угол окна для настроек и обратной связи — виден всегда, независимо от того,
 * сколько сплитов открыто в доке. Раньше своя кнопка настроек была внутри action-бара каждой
 * группы вкладок (`HeaderActions` в layout.tsx) — при сплите их становилось несколько сразу.
 */
export function GlobalCorner(): React.ReactElement {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-end p-2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card/90 p-1 shadow-lg shadow-black/30 backdrop-blur-md">
        <FeedbackButton />
        <IconButton label="Настройки" onClick={() => openPanel("settings")}>
          <Settings className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
