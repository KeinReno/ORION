"use client";

import type { KnowledgeItem } from "@orion/shared-types";
import { Button, cx } from "@orion/ui";
import { Check, FileText, Lightbulb, Link2 } from "lucide-react";
import { relativeTime } from "../../lib/format";

function inboxMeta(item: KnowledgeItem): { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; tint: string; text: string } {
  const origin = item.origin;
  if (item.kind === "link" || origin?.sourceUrl) return { icon: Link2, tint: "#34D399", text: "Ссылка из библиотеки" };
  if (origin?.sourceFile) return { icon: FileText, tint: "#60A5FA", text: `Импортировано из файла${origin.sourceFile ? ` · ${origin.sourceFile}` : ""}` };
  return { icon: Lightbulb, tint: "#F59E0B", text: "Мысль · введена вручную" };
}

/** Строка сырья входящих (экран 02): иконка-источник, заголовок, действия. */
export function InboxRow({
  item,
  selected,
  onAccept,
  onArchive,
  onContextMenu
}: {
  item: KnowledgeItem;
  selected: boolean;
  onAccept: () => void;
  onArchive: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}): React.ReactElement {
  const meta = inboxMeta(item);
  const Icon = meta.icon;
  return (
    <div
      onContextMenu={onContextMenu}
      className={cx(
        "flex items-center gap-3.5 rounded-xl border bg-card p-3.5 transition-colors",
        selected ? "border-[#C9A86A]" : "border-border"
      )}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px]" style={{ backgroundColor: `${meta.tint}1F` }}>
        <Icon className="h-4 w-4" style={{ color: meta.tint }} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-foreground">{item.title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-[#6E6A60]">{meta.text}</span>
      </span>
      <span className="hidden shrink-0 font-mono text-[11px] text-[#6E6A60] sm:block">{relativeTime(item.updatedAt)}</span>
      <span className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="border-[#C9A86A] text-[#E7D7A8] hover:bg-[#C9A86A14]"
          onClick={onAccept}
        >
          <Check className="h-3.5 w-3.5" /> Принять
        </Button>
        <Button size="sm" variant="ghost" className="text-[#6E6A60]" onClick={onArchive}>
          В архив
        </Button>
      </span>
    </div>
  );
}
