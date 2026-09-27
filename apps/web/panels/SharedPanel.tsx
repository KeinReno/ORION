"use client";

import { useCore, useSharedObject, useSharedWithMe } from "@orion/core-react";
import type { SharedGrantObjectType, SharedGrantSummary } from "@orion/shared-types";
import { Badge, Button, EmptyState, MarkdownView, PanelBody, PanelHeader, PanelShell, Skeleton, useToast } from "@orion/ui";
import { AlertCircle, Download, FileText, FolderKanban, Globe2, Receipt, StickyNote, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { describeError } from "../lib/error-message";
import { formatBytes } from "../lib/document-icons";
import { shortDateTime } from "../lib/format";

const TYPE_ICON: Record<SharedGrantObjectType, LucideIcon> = {
  note: StickyNote,
  document: FileText,
  project: FolderKanban,
  transaction: Receipt
};

const TYPE_LABEL: Record<SharedGrantObjectType, string> = {
  note: "Заметка",
  document: "Документ",
  project: "Проект",
  transaction: "Операция"
};

/**
 * «Доступно мне» — U09 (27-U09-THREAT-MODEL.md, раздел 6): the grantee's
 * side. Cross-workspace, ungrouped, same reasoning as `OverviewPanel` (U08)
 * for why it isn't gated by any single workspace's module state — the
 * source workspace here is one the caller isn't even a member of.
 *
 * Deliberately a flat list + a simple read-only viewer, not a mini editor:
 * T5 (read-only first version) — there is nowhere in this panel to edit,
 * comment, or link the shown object, because the grant-aware API has no
 * mutating route for it to call even if a button existed.
 */
export function SharedPanel(): React.ReactElement {
  const { data: grants, isLoading, isError, error, refetch } = useSharedWithMe();
  const [openGrantId, setOpenGrantId] = useState<string | null>(null);

  return (
    <PanelShell>
      <PanelHeader icon={Globe2} title="Доступно мне" subtitle="Объекты, к которым вам предоставили доступ владельцы других пространств" />
      <PanelBody className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            tone="danger"
            title="Не удалось загрузить список"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        ) : (grants ?? []).length === 0 ? (
          <EmptyState icon={Globe2} title="Пока ничего не расшарено" description="Когда владелец другого пространства предоставит вам доступ, запись появится здесь." />
        ) : (
          <ul className="space-y-1.5">
            {(grants ?? []).map((grant) => (
              <SharedGrantRow key={grant.grantId} grant={grant} onOpen={() => setOpenGrantId(grant.grantId)} />
            ))}
          </ul>
        )}
      </PanelBody>

      {openGrantId ? <SharedObjectViewer grantId={openGrantId} onClose={() => setOpenGrantId(null)} /> : null}
    </PanelShell>
  );
}

function SharedGrantRow({ grant, onOpen }: { grant: SharedGrantSummary; onOpen: () => void }): React.ReactElement {
  const Icon = TYPE_ICON[grant.objectType];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5 text-left hover:bg-white/5"
      >
        <Icon className="h-5 w-5 shrink-0 text-subtle-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-foreground">{TYPE_LABEL[grant.objectType]}</p>
          <p className="truncate text-micro text-subtle-foreground">Источник: {grant.sourceWorkspaceName}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone="neutral">Только просмотр</Badge>
          <span className="text-micro text-subtle-foreground">{grant.expiresAt ? `до ${shortDateTime(grant.expiresAt)}` : "без срока"}</span>
        </div>
      </button>
    </li>
  );
}

/** Read-only preview per type — deliberately not the editable component the owner sees. */
function SharedObjectViewer({ grantId, onClose }: { grantId: string; onClose: () => void }): React.ReactElement {
  const { api } = useCore();
  const { data, isLoading, isError, error } = useSharedObject(grantId);
  const { toast } = useToast();

  async function download(): Promise<void> {
    try {
      const blob = await api.getSharedDocumentBlob(grantId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data && data.objectType === "document" ? data.name : "file";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Не удалось скачать файл", description: describeError(err), tone: "danger" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <Badge tone="neutral">Только просмотр</Badge>
          <Button size="sm" variant="subtle" onClick={onClose}>
            Закрыть
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            tone="danger"
            title="Доступ недоступен"
            description={describeError(error)}
          />
        ) : data?.objectType === "note" ? (
          <div className="space-y-2">
            <h3 className="text-title text-foreground">{data.title || "Без названия"}</h3>
            <MarkdownView source={data.body} />
          </div>
        ) : data?.objectType === "document" ? (
          <div className="space-y-3">
            <h3 className="text-title text-foreground">{data.name}</h3>
            <p className="text-body text-subtle-foreground">
              {data.mimeType ?? "неизвестный тип"} · {data.sizeBytes !== null ? formatBytes(data.sizeBytes) : "размер неизвестен"}
            </p>
            <Button size="sm" onClick={() => void download()}>
              <Download className="h-4 w-4" /> Скачать
            </Button>
          </div>
        ) : data?.objectType === "project" ? (
          <div className="space-y-2">
            <h3 className="text-title text-foreground">{data.name}</h3>
            <p className="text-body text-subtle-foreground">Статус: {data.status}</p>
            {data.description ? <p className="text-body text-muted-foreground">{data.description}</p> : null}
            <p className="text-micro text-subtle-foreground">
              {data.startAt ? `Начало: ${shortDateTime(data.startAt)}` : ""} {data.dueAt ? `· Дедлайн: ${shortDateTime(data.dueAt)}` : ""}
            </p>
          </div>
        ) : data?.objectType === "transaction" ? (
          <div className="space-y-2">
            <h3 className="text-title text-foreground">Операция: {data.type}</h3>
            {data.note ? <p className="text-body text-muted-foreground">{data.note}</p> : null}
            <p className="text-micro text-subtle-foreground">{shortDateTime(data.occurredAt)}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
