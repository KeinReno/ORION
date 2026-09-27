// Copies the pdf.js worker out of node_modules into public/ so it is served
// as a plain static asset (no bundler / Terser touching it — the worker is an
// ESM file that breaks minification). Referenced by packages/ui's PdfView as
// `/pdf.worker.min.mjs`. Regenerable, so it's gitignored — this runs before
// dev/build. See docs/PLAN.md v0.12.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

try {
  const src = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(src, join(publicDir, "pdf.worker.min.mjs"));
  console.log("[copy-pdf-worker] public/pdf.worker.min.mjs updated");
} catch (err) {
  console.warn(`[copy-pdf-worker] skipped: ${err.message}`);
}
