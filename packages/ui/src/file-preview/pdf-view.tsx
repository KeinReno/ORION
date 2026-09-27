"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { cx } from "../primitives";

// Served from apps/web/public/ (copied there by scripts/copy-pdf-worker.mjs
// on dev/build) — a plain static file, no CDN, so it works in the offline
// desktop export too.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export default function PdfView({ url, className }: { url: string; className?: string }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ url });
    task.promise
      .then(async (doc) => {
        if (cancelled) return;
        setPageCount(doc.numPages);
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        for (let n = 1; n <= doc.numPages; n += 1) {
          if (cancelled) return;
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1.3 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-4 h-auto max-w-full rounded shadow-lg";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  if (error) {
    return <div className="p-6 text-sm text-muted-foreground">Не удалось открыть PDF: {error}</div>;
  }
  return (
    <div
      ref={containerRef}
      className={cx("orion-scroll h-full overflow-auto bg-black/20 p-4", className)}
      aria-label={pageCount ? `PDF, ${pageCount} стр.` : "PDF"}
    />
  );
}
