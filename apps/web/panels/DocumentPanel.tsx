"use client";

import { useCore, useDocuments, usePublishObjectContext } from "@orion/core-react";
import { ApiError } from "@orion/core";
import { Button, EmptyState, PanelBody, PanelShell, Skeleton, useToast } from "@orion/ui";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "../lib/error-message";
import type { PanelComponentProps } from "../lib/panel-registry";
import { useUnsavedDraft } from "../lib/unsaved-drafts";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { PreviewPane } from "./documents/preview-pane";

/** A view over the existing file and editor slot, not a second document store. */
export function DocumentPanel({ params, api: panelApi }: PanelComponentProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { api } = useCore();
  const { toast } = useToast();
  const documents = useDocuments(workspace?.id);
  const denied = documents.error instanceof ApiError && [401, 403, 404].includes(documents.error.status);
  const doc = denied ? undefined : documents.data?.find(item => item.id === params?.instanceId && item.kind === "file" && !item.deletedAt);
  const [dirty, setDirty] = useState(false);
  const title = doc?.name ?? "Документ";
  useUnsavedDraft(dirty);
  usePublishObjectContext({ workspaceId: doc ? workspace?.id ?? "" : "", entityType: "document", entityId: doc?.id ?? "", title, saveState: dirty ? "dirty" : "saved", hasPendingChanges: dirty });
  useEffect(() => { panelApi?.setTitle(title); }, [title, panelApi]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function download(): Promise<void> {
    if (!workspace || !doc) return;
    try {
      const blob = await api.getDocumentBlob(workspace.id, doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = doc.name;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { toast({ title: "Не удалось скачать", description: describeError(error), tone: "danger" }); }
  }

  return <PanelShell>
    {documents.isLoading ? <PanelBody><Skeleton className="h-64 w-full" /></PanelBody>
      : documents.isError && !doc ? <PanelBody><EmptyState icon={FileText} title="Не удалось загрузить документ" action={<Button onClick={() => void documents.refetch()}>Повторить</Button>} /></PanelBody>
      : !doc ? <PanelBody><EmptyState icon={FileText} title="Документ недоступен" description="Возможно, он удалён или у вас нет доступа." /></PanelBody>
      : <section aria-label="Документ" className="flex h-full min-h-0 flex-col">
        {documents.isError ? <div role="alert" className="shrink-0 border-b border-border px-4 py-2 text-label">Не удалось обновить сведения о файле. Редактор остаётся открыт.<Button size="sm" variant="outline" onClick={() => void documents.refetch()}>Повторить загрузку сведений</Button></div> : null}
        <div className="min-h-0 flex-1"><PreviewPane key={doc.id} doc={doc} onDownload={() => void download()} onEditorDirtyChange={setDirty} /></div>
      </section>}
  </PanelShell>;
}
