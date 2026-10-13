"use client";

/**
 * O04 — native DOCX editor tab. `React.lazy`-loaded (see `OfficeEditor.tsx`),
 * so Tiptap + mammoth's browser build only land in a chunk fetched when a
 * DOCX is actually opened — never in the login/main bundle.
 *
 * Model per 21-OFFICE-IMPLEMENTATION.md "Открытие/редактирование/сохранение":
 * open -> parse bytes to Tiptap JSON (client-only, `docxToTiptapJsonInBrowser`);
 * edit -> pure client React/Tiptap state; save -> serialize back to DOCX
 * bytes (`tiptapJsonToDocx`) and `POST .../documents/:id/content` via the
 * existing `useReplaceDocumentContent` (same contract as "replace content"
 * elsewhere in Documents — no new server code, see 12-PROGRESS.md "O02").
 *
 * A parse failure (corrupt/unsupported DOCX) does not crash the tab — it
 * degrades to the caller's read-only preview, exactly like
 * `packages/ui/src/file-preview/docx-view.tsx` already does for the
 * read-only path.
 */

import { useReplaceDocumentContent } from "@orion/core-react";
import type { DocumentItem } from "@orion/shared-types";
import { AutosaveStatus, Button, Spinner, cx, useToast } from "@orion/ui";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Save,
  Strikethrough,
  Table as TableIcon,
  Undo2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { docxToTiptapJsonInBrowser, officeDocExtensions, tiptapJsonToDocx } from "./codecs/docx-codec";
import { shouldAcceptRefetchedBlob } from "./codecs/editor-generation-guard";
import { DOCX_MIME } from "./codecs/office-files";

export interface OfficeEditorInnerProps {
  workspaceId: string;
  doc: DocumentItem;
  blob: Blob;
  /** Parsing failed — caller renders its own read-only fallback instead. */
  onParseFailed: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

export default function DocxEditor({ workspaceId, doc, blob, onParseFailed, onDirtyChange }: OfficeEditorInnerProps): React.ReactElement {
  const { toast } = useToast();
  const replaceContent = useReplaceDocumentContent(workspaceId);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  // F05: same edit-generation / saved-generation guard as xlsx-editor.tsx —
  // see that file's comments for the full rationale. `onUpdate` fires on
  // every keystroke (including the initial `setContent` from a freshly
  // parsed blob, which is filtered out below via `status`).
  const editGenerationRef = useRef(0);
  const savedGenerationRef = useRef(0);
  // `setContent()` (used only by the blob-load effect below, never by the
  // user) also fires `onUpdate` — suppressed here so a programmatic reload
  // is not mistaken for a user edit and does not bump `editGenerationRef`.
  const suppressGenerationBumpRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: officeDocExtensions(),
    content: { type: "doc", content: [] },
    editable: true,
    onUpdate: () => {
      setDirty(true);
      if (!suppressGenerationBumpRef.current) editGenerationRef.current += 1;
    }
  });

  // Parse the freshly downloaded bytes into Tiptap JSON once the editor
  // instance and the blob are both ready. A throw here (corrupt/unsupported
  // DOCX) degrades to the caller's read-only preview — never a crashed tab.
  useEffect(() => {
    if (!editor) return;
    let alive = true;
    setStatus("loading");
    // F05/R28-05: this effect re-fires on first open AND on every subsequent
    // react-query refetch/invalidation of `blob` — including right after
    // this editor's own successful save. The original guard compared
    // `editGenerationRef.current` to its own value *at the start of this
    // effect* (`generationAtFetchStart`) — that only catches typing that
    // happens WHILE this particular parse is in flight. It misses the case
    // where the draft was already dirty BEFORE this effect even started
    // (send A -> type B -> save-response/refetch arrives -> this effect
    // starts AFTER B was typed, so `generationAtFetchStart` already equals
    // the current generation, the check trivially "passes", and B gets
    // silently replaced by the server's A). The correct question is not
    // "did anything change during this fetch" but "is there ANY unsaved
    // edit right now" — i.e. compare against `savedGenerationRef`, the
    // generation as of the last successful save, not against a snapshot
    // taken mid-flight.
    blob
      .arrayBuffer()
      .then((bytes) => docxToTiptapJsonInBrowser(bytes))
      .then((json) => {
        if (!alive) return;
        if (!shouldAcceptRefetchedBlob(editGenerationRef.current, savedGenerationRef.current)) {
          // There is an unsaved edit (from before or during this fetch) —
          // keep the draft, do not overwrite it with server content that
          // may now be stale relative to it.
          setStatus("ready");
          return;
        }
        suppressGenerationBumpRef.current = true;
        editor.commands.setContent(json);
        suppressGenerationBumpRef.current = false;
        setDirty(false);
        savedGenerationRef.current = editGenerationRef.current;
        setStatus("ready");
      })
      .catch(() => {
        if (alive) onParseFailed();
      });
    return () => {
      alive = false;
    };
    // Re-parse only when the underlying blob identity changes (new open/restore).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blob]);

  // F05: warn on tab close/reload while there is unsaved input — same
  // pattern as `panels/note-editor.tsx`'s S11 guard. This editor has no
  // `onClose` of its own (embedded in `DocumentsPanel`'s preview pane,
  // switched by selecting another document, not a dedicated close button);
  // switching the selected document while dirty is a known, separate gap.
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent): void {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  async function save(): Promise<void> {
    if (!editor) return;
    const generationBeingSaved = editGenerationRef.current;
    try {
      const bytes = await tiptapJsonToDocx(editor.getJSON());
      const file = new File([bytes as unknown as BlobPart], doc.name, { type: DOCX_MIME });
      await replaceContent.mutateAsync({ id: doc.id, file });
      savedGenerationRef.current = generationBeingSaved;
      if (editGenerationRef.current === generationBeingSaved) {
        setDirty(false);
        toast({ title: "Сохранено", tone: "success" });
      } else {
        // User kept typing while the save was in flight — the bytes just
        // saved are already behind their draft; stay dirty so a fresh
        // Save is still prompted instead of falsely reporting "saved".
        toast({ title: "Сохранено (есть новые несохранённые изменения)", tone: "success" });
      }
    } catch (e) {
      toast({ title: "Не удалось сохранить", description: (e as Error).message, tone: "danger" });
    }
  }

  if (status === "loading" || !editor) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <ToolbarButton label="Отменить" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Повторить" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton label="Жирный" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Курсив" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Зачёркнутый" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-border" />
        {[1, 2, 3].map((level) => (
          <ToolbarButton
            key={level}
            label={`Заголовок ${level}`}
            active={editor.isActive("heading", { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}
          >
            {level === 1 ? <Heading1 className="h-4 w-4" /> : level === 2 ? <Heading2 className="h-4 w-4" /> : <Heading3 className="h-4 w-4" />}
          </ToolbarButton>
        ))}
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton label="Маркированный список" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Нумерованный список"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Вставить таблицу" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon className="h-4 w-4" />
        </ToolbarButton>
        <div className="ml-auto flex items-center gap-2">
          <AutosaveStatus state={replaceContent.isPending ? "saving" : replaceContent.isError ? "error" : dirty ? "dirty" : "saved"} />
          <Button size="sm" onClick={() => void save()} status={replaceContent.isPending ? "pending" : "idle"}>
            <Save className="h-4 w-4" /> Сохранить
          </Button>
        </div>
      </div>
      <div className="orion-scroll min-h-0 flex-1 overflow-auto bg-white p-8">
        <EditorContent
          editor={editor}
          className="mx-auto max-w-3xl text-sm leading-relaxed text-neutral-900 [&_.ProseMirror]:min-h-[60vh] [&_.ProseMirror]:outline-none [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2.5 [&_table]:my-3 [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent/15 text-accent-text hover:bg-accent/20 hover:text-accent-text"
      )}
    >
      {children}
    </button>
  );
}
