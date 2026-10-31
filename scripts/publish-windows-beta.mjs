#!/usr/bin/env node
/**
 * Publish an installable Windows beta from THIS checked-out Git commit.
 * Usage on Windows x64: node scripts/publish-windows-beta.mjs 36
 * Requires Node/corepack/pnpm, Rust/Tauri, .NET SDK and authenticated gh CLI.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = "KeinReno/ORION";
const numberText = process.argv[2];
if (numberText !== "auto" && !/^[1-9]\d*$/.test(numberText ?? "")) {
  throw new Error("Usage: node scripts/publish-windows-beta.mjs <beta-number|auto>, e.g. 36");
}
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Requires a Windows x64 build machine (Tauri + .NET + embedded PostgreSQL)");
}
function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}
function gh(...args) {
  return execFileSync("gh", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}
function pnpm(...args) {
  execFileSync("cmd.exe", ["/d", "/s", "/c", "corepack pnpm " + args.join(" ")], {
    cwd: root, stdio: "inherit", windowsHide: true,
    env: { ...process.env, ORION_BUILD_TAG: tag }
  });
}
if (git("status", "--porcelain", "--untracked-files=normal")) {
  throw new Error("Working tree has changes: commit or stash them before releasing");
}
const commit = git("rev-parse", "HEAD");
const releases = JSON.parse(gh("release", "list", "--repo", repo, "--limit", "100", "--json", "tagName"));
const numbers = releases.map((item) => /^v0\.1\.0-windows-beta\.(\d+)$/.exec(item.tagName)?.[1])
  .filter(Boolean).map(Number);
const betaNumber = numberText === "auto" ? Math.max(35, ...numbers) + 1 : Number(numberText);
if (!Number.isSafeInteger(betaNumber) || betaNumber > 9999) throw new Error("Invalid beta number");
const tag = "v0.1.0-windows-beta." + betaNumber;
if (numbers.some((n) => n >= betaNumber)) {
  throw new Error("Beta " + betaNumber + " is not newer than the latest published beta (" + Math.max(...numbers) + ")");
}
if (git("tag", "--list", tag)) throw new Error("Local tag " + tag + " already exists");
const tauriConf = path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
const originalConf = readFileSync(tauriConf, "utf8");
const config = JSON.parse(originalConf);
config.version = "0.1." + betaNumber;
const staging = mkdtempSync(path.join(os.tmpdir(), "orion-beta-release-"));
const notesFile = path.join(staging, "notes.md");
try {
  writeFileSync(tauriConf, JSON.stringify(config, null, 2) + "\n");
  console.log("Publishing " + tag + " from " + commit);
  pnpm("install", "--frozen-lockfile");
  pnpm("typecheck");
  pnpm("lint");
  pnpm("exec", "vitest", "run",
    "apps/web/plugins/documents-office/xlsx-grid-operations.test.ts",
    "apps/web/plugins/documents-office/codecs/xlsx-codec.test.ts",
    "apps/web/plugins/documents-office/codecs/docx-codec.test.ts",
    "apps/api/src/updates/release-feed.test.ts",
    "apps/api/src/updates/update.service.test.ts"
  );
  const started = Date.now();
  pnpm("build:desktop-installer");
  const nsis = path.join(root, "apps", "desktop", "src-tauri", "target", "release", "bundle", "nsis");
  if (!existsSync(nsis)) throw new Error("Tauri did not create the NSIS output folder");
  const installers = readdirSync(nsis).filter((name) => /-setup\.exe$/i.test(name))
    .map((name) => ({ name, full: path.join(nsis, name) }))
    .filter((item) => statSync(item.full).mtimeMs >= started - 5_000);
  if (installers.length !== 1) throw new Error("Expected exactly 1 freshly built NSIS installer, found " + installers.length);
  const installer = installers[0];
  const sha256 = createHash("sha256").update(readFileSync(installer.full)).digest("hex");
  writeFileSync(notesFile, [
    "ORION Windows Beta " + betaNumber,
    "",
    "Source commit: " + commit,
    "SHA-256 установщика: " + String.fromCharCode(96) + sha256 + String.fromCharCode(96),
    "",
    "Пререлиз для тестирования. Настройки → Обновления → канал Beta.",
    "Перед установкой сохраните открытые документы.",
    ""
  ].join("\n"), "utf8");
  gh("release", "create", tag, installer.full, "--repo", repo,
    "--target", commit, "--title", "ORION Windows Beta " + betaNumber,
    "--prerelease", "--notes-file", notesFile);
  console.log("PUBLISHED " + tag + " from " + commit);
} finally {
  writeFileSync(tauriConf, originalConf);
  rmSync(staging, { recursive: true, force: true });
}
