"use client";

import { FileQuestion } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { MarkdownView } from "./markdown";
import { Button, cx, EmptyState, Spinner } from "./primitives";

/**
 * ORION v0.12 "Документы" — the right-hand preview pane. Native rendering for
 * images / media / text; the three heavy renderers (PDF via `pdfjs-dist`,
 * Word via `mammoth`, spreadsheets via `xlsx`) are `React.lazy` so each lands
 * in its own async chunk, loaded only when a file of that type is opened.
 *
 * This is a deliberate exception to CLAUDE.md "UI-примитивы руками" — the same
 * kind of exception as the v0.9 CodeMirror/markdown-it editor. See docs/HISTORY.md
 * v0.12.
 */

const PdfView = lazy(() => import("./file-preview/pdf-view"));
const DocxView = lazy(() => import("./file-preview/docx-view"));
const SheetView = lazy(() => import("./file-preview/sheet-view"));

export type PreviewKind = "pdf" | "image" | "video" | "audio" | "word" | "sheet" | "markdown" | "text" | "unknown";

const TEXT_EXT = new Set([
  "txt", "text", "log", "json", "xml", "yaml", "yml", "toml", "ini", "env", "csv", "tsv",
  "md", "markdown", "rst",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "less", "html", "htm", "vue", "svelte",
  "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cc", "cs", "swift", "php",
  "sh", "bash", "zsh", "sql", "graphql", "dockerfile", "makefile", "gitignore"
]);

/** Best-effort classification from MIME type first, then file extension. */
export function previewKind(mime: string, name: string): PreviewKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"].includes(ext)) return "image";
  if (m.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "m4v", "ogv"].includes(ext)) return "video";
  if (m.startsWith("audio/") || ["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac"].includes(ext)) return "audio";
  if (m.includes("wordprocessingml") || ext === "docx") return "word";
  if (
    m.includes("spreadsheetml") ||
    m === "application/vnd.ms-excel" ||
    m === "text/csv" ||
    ["xlsx", "xls", "csv", "tsv", "ods"].includes(ext)
  ) {
    return "sheet";
  }
  if (ext === "md" || ext === "markdown") return "markdown";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml" || TEXT_EXT.has(ext)) return "text";
  return "unknown";
}

export interface FilePreviewProps {
  mime: string;
  name: string;
  /** Object URL for the file's bytes (created and revoked by the caller). */
  url: string;
  /** Invoked from the "no preview" state. */
  onDownload?: () => void;
  className?: string;
}

export function FilePreview({ mime, name, url, onDownload, className }: FilePreviewProps): React.ReactElement {
  const kind = useMemo(() => previewKind(mime, name), [mime, name]);
  const loading = (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );

  switch (kind) {
    case "image":
      return (
        <div className={cx("orion-scroll flex h-full items-center justify-center overflow-auto p-4", className)}>
          <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case "video":
      return (
        <div className={cx("flex h-full items-center justify-center bg-black/40 p-2", className)}>
          <video src={url} controls className="max-h-full max-w-full" />
        </div>
      );
    case "audio":
      return (
        <div className={cx("flex h-full items-center justify-center p-6", className)}>
          <audio src={url} controls className="w-full max-w-md" />
        </div>
      );
    case "markdown":
    case "text":
      return <TextPreview url={url} markdown={kind === "markdown"} className={className} />;
    case "pdf":
      return (
        <Suspense fallback={loading}>
          <PdfView url={url} className={className} />
        </Suspense>
      );
    case "word":
      return (
        <Suspense fallback={loading}>
          <DocxView url={url} className={className} />
        </Suspense>
      );
    case "sheet":
      return (
        <Suspense fallback={loading}>
          <SheetView url={url} name={name} className={className} />
        </Suspense>
      );
    default:
      return (
        <div className={cx("flex h-full items-center justify-center p-6", className)}>
          <EmptyState
            icon={FileQuestion}
            title="Предпросмотр недоступен"
            description="Для этого типа файла нет встроенного просмотра — его можно скачать."
            action={
              onDownload ? (
                <Button size="sm" variant="outline" onClick={onDownload}>
                  Скачать
                </Button>
              ) : undefined
            }
          />
        </div>
      );
  }
}

/** ~2 MB cap so a huge log file can't lock the tab up. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function TextPreview({ url, markdown, className }: { url: string; markdown: boolean; className?: string }): React.ReactElement {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(url)
      .then((r) => r.blob())
      .then(async (blob) => {
        const slice = blob.size > MAX_TEXT_BYTES ? blob.slice(0, MAX_TEXT_BYTES) : blob;
        const content = await slice.text();
        if (!alive) return;
        setText(content);
        setTruncated(blob.size > MAX_TEXT_BYTES);
        setState("ok");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (state === "error") return <div className="p-6 text-sm text-muted-foreground">Не удалось прочитать файл.</div>;
  if (state === "loading" || text === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className={cx("orion-scroll h-full overflow-auto p-5", className)}>
      {truncated ? (
        <p className="mb-3 text-2xs text-subtle-foreground">Показаны первые 2 МБ файла.</p>
      ) : null}
      {markdown ? (
        <MarkdownView source={text} />
      ) : (
        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{text}</pre>
      )}
    </div>
  );
}
