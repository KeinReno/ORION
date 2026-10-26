import { useEffect, useState } from "react";
export function MarkdownPreview({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true; setHtml(""); setFailed(false);
    void import("./markdown-render").then(({ previewMarkdown }) => { if (active) setHtml(previewMarkdown(source)); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [source, open]);
  return <details className="markdown-preview" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Предпросмотр Markdown</summary>
    {open && <><p className="helper">Ссылки и изображения показаны текстом. Исходный текст не меняется.</p>
      {failed ? <p role="alert">Не удалось открыть предпросмотр. Исходный текст остаётся в редакторе; закройте и откройте предпросмотр ещё раз.</p> : <div className="markdown-body" aria-label="Предпросмотр текста" dangerouslySetInnerHTML={{ __html: html || (source ? "<p>Готовим предпросмотр…</p>" : "<p>Пока нет текста.</p>") }} />}</>}
  </details>;
}
