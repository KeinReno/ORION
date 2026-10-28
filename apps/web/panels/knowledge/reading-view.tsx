"use client";

import type { KnowledgeItemDetail } from "@orion/shared-types";
import { Button, MarkdownView } from "@orion/ui";
import { BookOpen, X } from "lucide-react";
import { estimateReadMinutes } from "../../lib/knowledge-reading";
import { relativeTime } from "../../lib/format";
import { KIND_ICON, KIND_LABEL, SOURCE_LABEL } from "./knowledge-labels";

/** "N мин" / "меньше минуты" — read time is never shown as "0 мин", which would read as broken. */
function readTimeLabel(minutes: number): string {
  if (minutes === 0) return "";
  if (minutes === 1) return "1 мин чтения";
  return `${minutes} мин чтения`;
}

/**
 * "Режим чтения" — the distraction-free layout the owner asked for after seeing article-reader
 * open-source projects: one centred column, a serif body at reading size, the editing chrome
 * (status/visibility/category Selects, autosave status line) gone entirely rather than just
 * hidden — this is for READING a material straight through, not a quieter editor. Source stays
 * visible as a plain citation line (an article without its source is a worse article), never a
 * form. Exiting goes back to the same editor, same item, same scroll position lost on purpose —
 * this view has its own.
 */
export function KnowledgeReadingView({
  item,
  onExit
}: {
  item: KnowledgeItemDetail;
  onExit: () => void;
}): React.ReactElement {
  const minutes = estimateReadMinutes(item.body);
  const Icon = KIND_ICON[item.kind];
  const primarySource = item.sources[0];

  return (
    <div className="mx-auto flex max-w-[70ch] flex-col gap-6 pb-20">
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="flex items-center gap-1.5 text-micro uppercase tracking-wide text-subtle-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {KIND_LABEL[item.kind]}
        </span>
        <Button size="sm" variant="ghost" onClick={onExit}>
          <X className="h-4 w-4" /> Выйти из чтения
        </Button>
      </div>

      <div className="space-y-3">
        <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-foreground">{item.title}</h1>
        {item.summary ? <p className="font-serif text-title italic leading-relaxed text-muted-foreground">{item.summary}</p> : null}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-subtle-foreground">
          <span>Обновлено {relativeTime(item.updatedAt)}</span>
          {minutes > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>{readTimeLabel(minutes)}</span>
            </>
          ) : null}
          {primarySource ? (
            <>
              <span aria-hidden>·</span>
              <span>
                Источник: {SOURCE_LABEL[primarySource.type]}
                {primarySource.sourceTitle ? ` «${primarySource.sourceTitle}»` : ""}
                {primarySource.sourceAuthor ? `, ${primarySource.sourceAuthor}` : ""}
              </span>
            </>
          ) : null}
        </p>
        {item.tags.length > 0 ? (
          <p className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-card-hover px-2 py-0.5 text-micro text-muted-foreground">
                #{tag}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      {item.body.trim() ? (
        <MarkdownView source={item.body} className="font-serif text-body leading-[1.8] [&_p]:mb-4" />
      ) : (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-label text-subtle-foreground">
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden />У материала пока нет текста — выйдите из чтения, чтобы написать его.
        </p>
      )}
    </div>
  );
}
