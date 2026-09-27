"use client";

import { useEffect, useState } from "react";
// mammoth ships type declarations for its main entry only; the browser build
// exposes the same `convertToHtml` API.
// @ts-expect-error - no types for the browser subpath
import * as mammoth from "mammoth/mammoth.browser";
import { cx, Spinner } from "../primitives";

/**
 * Very small allowlist-ish scrub of mammoth's output: it only ever emits
 * headings / paragraphs / lists / tables / basic inline marks / links /
 * data-URI images, but strip anything scriptable just in case.
 */
function sanitize(html: string): string {
  return html
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script>/gi, "")
    .replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style>/gi, "")
    .replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/ on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
}

export default function DocxView({ url, className }: { url: string; className?: string }): React.ReactElement {
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((arrayBuffer) => mammoth.convertToHtml({ arrayBuffer }))
      .then((result: { value: string }) => {
        if (!alive) return;
        setHtml(sanitize(result.value));
        setState("ok");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (state === "error") return <div className="p-6 text-sm text-muted-foreground">Не удалось открыть документ Word.</div>;
  if (state === "loading" || html === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className={cx("orion-scroll h-full overflow-auto bg-white p-8 text-sm leading-relaxed text-neutral-900", className)}>
      <div
        className="mx-auto max-w-3xl [&_a]:text-blue-700 [&_a]:underline [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:my-3 [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2.5 [&_table]:my-3 [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
        // Content is mammoth-generated from the user's own file and scrubbed above.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
