"use client";

import { useNote, useProjects, useUpdateNote } from "@orion/core-react";
import type { Note } from "@orion/shared-types";
import { EmptyState, PanelBody, PanelShell, Skeleton, useToast } from "@orion/ui";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { PanelComponentProps } from "../lib/panel-registry";
import { saveNoteWithRevision } from "../lib/note-save";
import { ReplicaBanner } from "../components/replica-banner";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { NoteEditor, type NoteEditorInput } from "./note-editor";

/**
 * One note as a panel of its own (dock tab or detached window), next to others or on
 * a second monitor. It is the very same editor the Notes panel uses — same autosave,
 * same revision check — over the same API, so several notes can be open at once and an
 * edit is visible everywhere. Archive / duplicate / delete stay in the list; this view
 * edits. The note is fetched with the viewer's own rights; a saved panel id grants nothing.
 */
export function NoteWindowPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const noteId = params?.instanceId;
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { isEnabled } = useEnabledModules();
  const { toast } = useToast();
  const { data: note, isError, isLoading } = useNote(workspaceId, noteId);
  const { data: projects } = useProjects(isEnabled("projects") ? workspaceId : undefined);
  const updateNote = useUpdateNote(workspaceId);
  // Bumped to remount the editor on fresh server content (after a revision restore).
  const [reloadKey, setReloadKey] = useState(0);

  const title = note?.title;
  useEffect(() => {
    if (title) api?.setTitle(title);
  }, [api, title]);

  if (!noteId || isError) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState icon={FileText} title="Заметка не найдена" description="Возможно, она удалена или недоступна." />
        </PanelBody>
      </PanelShell>
    );
  }
  if (isLoading || !note) {
    return (
      <PanelShell>
        <PanelBody>
          <Skeleton className="h-64 w-full" />
        </PanelBody>
      </PanelShell>
    );
  }

  async function handleSave(id: string, input: NoteEditorInput, expectedRevision: number, opts?: { silent?: boolean }): Promise<Note> {
    const saved = await saveNoteWithRevision(updateNote.mutateAsync, id, input, expectedRevision);
    if (!opts?.silent) toast({ title: "Сохранено", tone: "success" });
    return saved;
  }

  return (
    <PanelShell>
      <ReplicaBanner workspaceId={workspaceId} />
      <NoteEditor
        key={`${note.id}:${reloadKey}`}
        note={note}
        workspaceId={workspaceId}
        projects={isEnabled("projects") ? (projects ?? []) : undefined}
        busy={false}
        standalone
        onCreate={async () => undefined}
        onSave={handleSave}
        onClose={() => api?.close?.()}
        onReload={() => setReloadKey((k) => k + 1)}
      />
    </PanelShell>
  );
}
