#!/usr/bin/env node
// Production runtime for @orion/shared-types inside the API build.
//
// `@orion/shared-types` is consumed as TypeScript source (`main: ./src/index.ts`)
// by Next (transpilePackages) and by ts-node-dev in development. Plain
// `node dist/main.js` cannot load that: Node meets extensionless `.ts` imports and
// stops with ERR_MODULE_NOT_FOUND, so the compiled API had no working production
// start. Instead of changing how every consumer resolves the package, the API
// build compiles it once into `apps/api/dist/node_modules/@orion/shared-types`.
// Node resolves `require("@orion/shared-types")` from `dist/**` against
// `dist/node_modules` first, so development resolution is untouched.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharedTypes = join(root, "packages", "shared-types");
const outDir = join(root, "apps", "api", "dist", "node_modules", "@orion", "shared-types");
const require = createRequire(join(root, "apps", "api", "package.json"));
const ts = require("typescript");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const program = ts.createProgram([join(sharedTypes, "src", "index.ts")], {
  target: ts.ScriptTarget.ES2021,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  esModuleInterop: true,
  skipLibCheck: true,
  strict: true,
  resolveJsonModule: true,
  declaration: false,
  rootDir: join(sharedTypes, "src"),
  outDir
});
const emit = program.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics);
if (emit.emitSkipped || diagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n"
  }));
  process.exit(1);
}
writeFileSync(join(outDir, "package.json"), JSON.stringify({ name: "@orion/shared-types", version: "0.0.0-runtime", main: "index.js" }, null, 2) + "\n");
copyFileSync(join(sharedTypes, "development-plan.cjs"), join(outDir, "development-plan.cjs"));
console.log(`[build-api-runtime] @orion/shared-types -> ${outDir}`);
