"use client";

import { Inbox } from "lucide-react";
import { cx } from "@orion/ui";
import { useState } from "react";

/**
 * Зона приёма входящих (экран 02): файлы drag&drop, ссылка — вставкой
 * (Cmd/Ctrl+V). Обработчики приходят снаружи — импорт живёт в панели.
 */
export function DropZone({
  disabled,
  onFiles,
  onUrl
}: {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onUrl: (url: string) => void;
}): React.ReactElement {
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Перетащите файлы или вставьте ссылку"
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length) onFiles(files);
      }}
      onPaste={(event) => {
        const text = event.clipboardData?.getData("text")?.trim() ?? "";
        if (/^https?:\/\/\S+$/i.test(text)) {
          event.preventDefault();
          onUrl(text);
        }
      }}
      className={cx(
        "grid h-[72px] w-full cursor-pointer place-items-center rounded-xl border border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        over ? "border-[#C9A86A] bg-[#C9A86A14]" : "border-[#4A463C]",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <span className="flex items-center gap-2.5 text-[13px] text-[#BEB9AF]">
        <Inbox className="h-4 w-4 text-[#C9A86A]" aria-hidden />
        Перетащите файлы или вставьте ссылку — появятся во входящих
      </span>
    </div>
  );
}
