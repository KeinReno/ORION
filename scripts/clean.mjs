#!/usr/bin/env node
/**
 * Removes ORION's regenerable build artifacts.
 *
 * Why this exists: the repository directory grew to ~6.6 GB, of which ~6.5 GB
 * was `apps/desktop/src-tauri/target` (Rust build cache) and `apps/web/.next` —
 * all of it already in .gitignore, none of it source. Run `pnpm clean` when the
 * folder looks unreasonably large; everything below rebuilds on demand
 * (`tauri build`, `next build`, `pnpm install`).
 *
 * Safety rules, deliberately strict:
 *  - only paths from the allowlist below are ever removed;
 *  - `apps/api/.data` (real uploaded documents) and anything under it is never
 *    touched, and neither is `.git`;
 *  - `node_modules` goes only with `--deps`, because it needs a reinstall.
 *
 * Usage: `node scripts/clean.mjs [--deps] [--dry-run]`
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Regenerable build output, per package. Paths relative to the repo root. */
const ARTIFACTS = [
  "apps/desktop/src-tauri/target",
  "apps/web/.next",
  "apps/web/.next-desktop",
  "apps/web/out",
  "apps/api/dist",
  "packages/shared-types/dist",
  "packages/core/dist",
  "packages/core-react/dist",
  "packages/ui/dist",
  ".turbo"
];

/** Only with --deps: reinstalled by `pnpm install`. */
const DEPS = ["node_modules"];

/** Never removable, even if a caller adds it: user data and VCS history. */
const FORBIDDEN = ["apps/api/.data", ".git"];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const withDeps = args.has("--deps");

function directorySize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += directorySize(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

function format(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function assertSafe(target) {
  const absolute = resolve(ROOT, target);
  const insideRepo = !relative(ROOT, absolute).startsWith("..");
  const isForbidden = FORBIDDEN.some((guard) => absolute === resolve(ROOT, guard) || absolute.startsWith(resolve(ROOT, guard) + "\\"));
  if (!insideRepo || isForbidden) {
    throw new Error(`refusing to remove ${target}: outside the repo or on the protected list`);
  }
  return absolute;
}

const targets = withDeps ? [...ARTIFACTS, ...DEPS] : ARTIFACTS;
let freed = 0;
let removed = 0;

for (const target of targets) {
  const absolute = assertSafe(target);
  if (!existsSync(absolute)) continue;
  const size = directorySize(absolute);
  freed += size;
  removed += 1;
  console.log(`${dryRun ? "would remove" : "removing"} ${target} (${format(size)})`);
  if (!dryRun) rmSync(absolute, { recursive: true, force: true });
}

const total = directorySize(ROOT);
console.log(
  `\n${dryRun ? "Would free" : "Freed"} ${format(freed)} across ${removed} director${removed === 1 ? "y" : "ies"}.`
);
console.log(`Repository now: ${format(total)}${withDeps ? " (node_modules removed — run `pnpm install`)" : ""}`);
if (!withDeps) {
  console.log("Tip: `pnpm clean --deps` also drops node_modules; the global pnpm store is pruned with `pnpm store prune`.");
}
