"use client";

import type { KnowledgeCategory, KnowledgeItemDetail, KnowledgeSourceType } from "@orion/shared-types";
import { Button, MarkdownView, useContextMenuApi } from "@orion/ui";
import { BookOpen, FileText, Link2, MoreHorizontal, PenLine, StickyNote } from "lucide-react";
import { relativeTime } from "../../lib/format";
import { estimateReadMinutes } from "../../lib/knowledge-reading";
import { KindChip } from "./kind-chip";
import { KIND_ICON, RELATION_LABEL, SOURCE_LABEL, STATUS_LABEL } from "./knowledge-labels";

const SOURCE_ICON: Record<KnowledgeSourceType, React.ComponentType<{ className?: string }>> = {
  url: Link2,
  note: StickyNote,
  document: FileText,
  manual: BookOpen,
  other: FileText
};

/**
 * Экран 03 «Материал»: чтение. Колонка 640px с заголовком и телом, справа —
 * источник, связанные материалы, теги и мета. Редактор открывается кнопкой
 * «Редактировать» (панель переключается в режим редактирования).
 */
export function KnowledgeReadingView({
  item,
  categories,
  onBack,
  onEdit,
  onOpenItem,
  menuItems
}: {
  item: KnowledgeItemDetail;
  categories: KnowledgeCategory[];
  onBack: () => void;
  onEdit: () => void;
  onOpenItem: (id: string) => void;
  menuItems: () => Array<{ label: string; onSelect: () => void } | "separator">;
}): React.ReactElement {
  const showContextMenu = useContextMenuApi();
  const minutes = estimateReadMinutes(item.body);
  const primarySource = item.sources[0];
  const SourceIcon = primarySource ? SOURCE_ICON[primarySource.type] : FileText;
  const collection = categories.find((entry) => entry.id === item.categoryId);
  const related = [...item.relations, ...item.backlinks.filter((link) => !item.relations.some((existing) => existing.peerId === link.peerId))];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[1060px] gap-16 px-6 pb-16 pt-4 [@container(max-width:900px)]:flex-col [@container(max-width:900px)]:gap-8">
        <article className="min-w-0 flex-1" style={{ maxWidth: 640 }}>
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={onBack}>← Библиотека</Button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="border-[#4A463C]" onClick={onEdit}>
                <PenLine className="h-3.5 w-3.5" /> Редактировать
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Действия с материалом"
                onClick={(event) => showContextMenu(event, menuItems())}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <KindChip kind={item.kind} />
            <span className="rounded-md bg-[#C9A86A14] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#E7D7A8]">
              {STATUS_LABEL[item.status]}
            </span>
            <span className="font-mono text-[11px] text-[#6E6A60]">
              обновлено {relativeTime(item.updatedAt)}
              {minutes > 1 ? ` · ${minutes} мин чтения` : ""}
            </span>
          </div>

          <h1 className="mt-4 text-[26px] font-semibold leading-tight text-foreground">{item.title}</h1>
          {item.summary.trim() ? <p className="mt-2 text-[14px] leading-relaxed text-[#BEB9AF]">{item.summary}</p> : null}

          {item.body.trim() ? (
            <MarkdownView source={item.body} className="mt-6 text-[15px] leading-[25px] text-foreground [&_p]:mb-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[#C9A86A] [&_blockquote]:pl-3 [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-[17px] [&_h2]:font-semibold" />
          ) : (
            <p className="mt-6 flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-[13px] text-[#6E6A60]">
              <BookOpen className="h-4 w-4 shrink-0" aria-hidden />У материала пока нет текста — откройте редактор, чтобы написать его.
            </p>
          )}
        </article>

        <aside className="w-full shrink-0 [@container(min-width:900px)]:w-[380px]">
          {primarySource ? (
            <section aria-label="Источник">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6E6A60]">Источник</h2>
              <div className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-[#C9A86A14] text-[#C9A86A]">
                  <SourceIcon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {primarySource.sourceTitle || SOURCE_LABEL[primarySource.type]}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-[#6E6A60]">
                    {primarySource.type === "url" && primarySource.sourceUrl
                      ? primarySource.sourceUrl.replace(/^https?:\/\//, "").slice(0, 48)
                      : SOURCE_LABEL[primarySource.type]}
                  </span>
                </span>
              </div>
            </section>
          ) : null}

          {related.length > 0 ? (
            <section aria-label="Связанные материалы" className="mt-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6E6A60]">Связанные материалы</h2>
              <ul className="mt-2 space-y-1">
                {related.map((link) => {
                  const Icon = KIND_ICON[item.kind];
                  return (
                    <li key={link.id}>
                      <button
                        type="button"
                        onClick={() => onOpenItem(link.peerId)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-[#6E6A60]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{link.peerTitle}</span>
                        <span className="shrink-0 text-[10px] text-[#6E6A60]">{RELATION_LABEL[link.kind]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {item.tags.length > 0 ? (
            <section aria-label="Теги" className="mt-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6E6A60]">Теги</h2>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-card-hover px-2.5 py-1 text-[11px] text-[#BEB9AF]">#{tag}</span>
                ))}
              </p>
            </section>
          ) : null}

          <p className="mt-6 font-mono text-[11px] leading-5 text-[#6E6A60]">
            добавлено {relativeTime(item.createdAt)}
            <br />
            коллекция: {collection?.name ?? "без коллекции"}
          </p>
        </aside>
      </div>
    </div>
  );
}
