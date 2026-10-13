// Copies modern-xlsx's precompiled WASM binary out of node_modules into
// public/ so the browser can `fetch()` it as a plain static asset — same
// pattern as copy-pdf-worker.mjs for pdf.js's worker (see that file's
// comment). Referenced by apps/web/plugins/documents-office/codecs/xlsx-codec.ts's
// `ensureModernXlsxWasm` as `/modern-xlsx.wasm` when running in the browser
// (Node keeps reading the file straight from node_modules via `node:fs`,
// unaffected). Regenerable, so it's gitignored — this runs before dev/build.
// See docs/HISTORY.md "O04-follow-up" for why this
// was needed: modern-xlsx's default `initWasm()` auto-detects the .wasm URL
// via `import.meta.url`, which after webpack bundling points at the emitted
// JS chunk, not at node_modules — an explicit URL to a statically served
// copy of the .wasm file is the documented fix (`initWasm(url)`).
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

try {
  // modern-xlsx's package.json exports map doesn't expose the raw .wasm
  // file directly, so resolve the package entry point and find it relative
  // to that (pnpm nests the real package under node_modules/.pnpm/).
  const entryPoint = require.resolve("modern-xlsx");
  const src = join(dirname(entryPoint), "modern-xlsx.wasm");
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(src, join(publicDir, "modern-xlsx.wasm"));
  console.log("[copy-modern-xlsx-wasm] public/modern-xlsx.wasm updated");
} catch (err) {
  console.warn(`[copy-modern-xlsx-wasm] skipped: ${err.message}`);
}
