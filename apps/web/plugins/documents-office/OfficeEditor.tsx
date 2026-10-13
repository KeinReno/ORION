"use client";

/**
 * O04 — entry point for the native office editor tab. Dispatches to the
 * DOCX or XLSX editor, both `React.lazy`-loaded so Tiptap / mammoth /
 * exceljs / HyperFormula / modern-xlsx never land in the login/main bundle
 * — same pattern as `@orion/ui`'s `FilePreview` (`packages/ui/src/file-preview.tsx`,
 * O01.12): this file itself is plain and cheap, the heavy renderers are the
 * lazy chunks.
 *
 * Embedded in `DocumentsPanel`'s existing preview pane (the panel is
 * already the "large editor tab" the UX plan calls for — see
 * 20-DOCUMENT-EDITORS.md "Рабочая поверхность" and 12-PROGRESS.md "O04" for
 * why this reuses the pane instead of a new Workbench panel type).
 *
 * Fetches bytes via the existing `useDocumentBlob` (same hook the read-only
 * `PreviewPane` already uses), so opening an office file costs exactly one
 * more network round trip than opening any other file — no new server
 * contract (O02's decision).
 */

import { useDocumentBlob } from "@orion/core-react";
import type { DocumentItem } from "@orion/shared-types";
import { Button, EmptyState, Spinner } from "@orion/ui";
import { AlertTriangle, FileWarning } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { isDocxDocument, isXlsxDocument } from "./codecs/office-kind";

const DocxEditor = lazy(() => import("./docx-editor"));
const XlsxEditor = lazy(() => import("./xlsx-editor"));

export interface OfficeEditorProps {
  workspaceId: string;
  doc: DocumentItem;
  /** Falls back to plain download/preview when the file isn't DOCX/XLSX, or parsing fails. */
  fallback: React.ReactNode;
  onDirtyChange: (dirty: boolean) => void;
}

export function OfficeEditor({ workspaceId, doc, fallback, onDirtyChange }: OfficeEditorProps): React.ReactElement {
  const { data: blob, isLoading, isError, refetch } = useDocumentBlob(workspaceId, doc.id);
  const [parseFailed, setParseFailed] = useState(false);

  if (parseFailed) {
    return <>{fallback}</>;
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Не удалось загрузить файл"
          action={
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Повторить
            </Button>
          }
        />
      </div>
    );
  }

  if (isLoading || !blob) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const loading = (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );

  if (isDocxDocument(doc)) {
    return (
      <Suspense fallback={loading}>
        <DocxEditor workspaceId={workspaceId} doc={doc} blob={blob} onParseFailed={() => setParseFailed(true)} onDirtyChange={onDirtyChange} />
      </Suspense>
    );
  }
  if (isXlsxDocument(doc)) {
    return (
      <Suspense fallback={loading}>
        <XlsxEditor workspaceId={workspaceId} doc={doc} blob={blob} onParseFailed={() => setParseFailed(true)} onDirtyChange={onDirtyChange} />
      </Suspense>
    );
  }

  // Not actually an office document — shouldn't be reached if the caller
  // checks `isOfficeFile` first, but degrade gracefully rather than
  // rendering nothing.
  return (
    <div className="p-6">
      <EmptyState icon={FileWarning} title="Неподдерживаемый формат" description="Для этого файла нет native-редактора." />
    </div>
  );
}
