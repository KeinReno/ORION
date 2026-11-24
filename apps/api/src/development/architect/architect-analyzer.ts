import { promises as fs } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import type {
  ArchitectEdge,
  ArchitectMetrics,
  ArchitectNode,
  ArchitectNodeKind
} from "@orion/shared-types";

/**
 * Анализатор репозитория (11.3): файловая карта и граф импортов на уровне регулярных выражений.
 *
 * Никакого AST: полноценный парсер TS/Rust притащил бы тяжёлую зависимость, а для карты нужно
 * «какой файл от чего зависит», не типы. Разбор намеренно терпим к синтаксису, который не понимает:
 * пропущенный импорт хуже, чем ошибка парсера, только если он меняет картину; здесь карта — подсказка
 * для 2D-редактора, а не компилятор.
 */

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".pnpm",
  "dist",
  "build",
  "out",
  ".next",
  ".next-desktop",
  ".turbo",
  "target",
  "coverage",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".data",
  "tmp",
  ".cache"
]);

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const TS_RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const MAX_FILES_DEFAULT = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface AnalyzeInput {
  /** Абсолютный корень рабочей копии. */
  rootPath: string;
  /** Подкаталог внутри корня (posix, `""` — весь репозиторий). */
  subPath?: string;
  maxFiles?: number;
}

export interface ArchitectLaunch {
  path: string;
  kind: "main" | "route" | "cron" | "script";
  label: string;
}

export interface AnalyzeResult {
  nodes: ArchitectNode[];
  edges: ArchitectEdge[];
  metrics: ArchitectMetrics;
  truncated: boolean;
  launches: ArchitectLaunch[];
}

const LAUNCH_CAP = 24;

/** Точки, которые файл реально стартует. Импорт сюда не входит. */
export function extractLaunchPoints(filePath: string, source: string): ArchitectLaunch[] {
  const found: ArchitectLaunch[] = [];
  const base = filePath.split("/").pop() ?? filePath;
  if (base === "package.json") {
    try {
      const parsed = JSON.parse(source) as { scripts?: Record<string, unknown> };
      for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
        if (found.length >= LAUNCH_CAP) break;
        found.push({ path: filePath, kind: "script", label: `${name}: ${String(command).slice(0, 80)}` });
      }
    } catch {
      return found;
    }
    return found;
  }
  if (base === "main.rs" || /\bfn\s+main\s*\(/.test(source)) found.push({ path: filePath, kind: "main", label: "fn main" });
  else if (/^main\.(ts|tsx|js|mjs|cjs)$/.test(base) || /NestFactory\.create\s*\(/.test(source)) found.push({ path: filePath, kind: "main", label: base });
  for (const match of source.matchAll(/@Cron\(\s*(?:CronExpression\.(\w+)|["'`]([^"'`]*)["'`])/g)) {
    if (found.length >= LAUNCH_CAP) break;
    found.push({ path: filePath, kind: "cron", label: match[1] || match[2] || "@Cron" });
  }
  for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:["'`]([^"'`]*)["'`])?/g)) {
    if (found.length >= LAUNCH_CAP) break;
    const verb = (match[1] ?? "Get").toUpperCase();
    found.push({ path: filePath, kind: "route", label: match[2] ? `${verb} ${match[2]}` : verb });
  }
  return found;
}

interface FileEntry {
  /** Путь относительно корня репозитория, posix. */
  path: string;
  size: number;
}

interface DirectoryEntry {
  path: string;
  name: string;
  parent: string | null;
  depth: number;
  kind: ArchitectNodeKind;
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function isTsFile(path: string): boolean {
  return TS_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function isRustFile(path: string): boolean {
  return path.endsWith(".rs");
}

/** `apps/api/src/main.ts` → `apps/api/src` (или `""` для файла в корне). */
export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/**
 * Импорты TS/TSX. Четыре независимых формы (`import … from`, `export … from`, `require`,
 * динамический `import()`); повтор одного спецификатора не создаёт второе ребро.
 */
export function extractTsImports(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]?.trim();
      if (specifier) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

/**
 * Разрешение относительного импорта в файл репозитория. `./x.js` в TS-проектах означает `./x.ts`
 * (ESM-стиль импорта с расширением .js) — пробуем и замену расширения.
 */
export function resolveTsImport(fromPath: string, specifier: string, files: ReadonlySet<string>): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const base = posix.normalize(posix.join(parentPath(fromPath), specifier));
  if (base.startsWith("../") || base === "..") return null;
  const withoutExtension = base.replace(/\.(m|c)?(t|j)sx?$/i, "");
  const candidates = [
    base,
    ...TS_RESOLVE_EXTENSIONS.map((extension) => base + extension),
    ...TS_RESOLVE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
    ...TS_RESOLVE_EXTENSIONS.map((extension) => withoutExtension + extension),
    ...TS_RESOLVE_EXTENSIONS.map((extension) => `${withoutExtension}/index${extension}`)
  ];
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/** Имя пакета из внешнего спецификатора: `@scope/name/sub` → `@scope/name`, `lodash/fp` → `lodash`. */
export function externalPackageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

/** `mod foo;` и `use crate::a::b::{c, d};` — путь модуля без элементов `self/super/crate`. */
export function extractRustModuleRefs(source: string): Array<{ kind: "mod" | "use"; path: string[] }> {
  const refs: Array<{ kind: "mod" | "use"; path: string[] }> = [];
  for (const match of source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm)) {
    if (match[1]) refs.push({ kind: "mod", path: [match[1]] });
  }
  for (const match of source.matchAll(/^\s*(?:pub\s+)?use\s+((?:::)?[A-Za-z_][A-Za-z0-9_:]*)/gm)) {
    const raw = match[1];
    if (!raw) continue;
    const path = raw
      .replace(/^::/, "")
      .split("::")
      .map((part) => part.trim())
      .filter((part) => part && part !== "self");
    if (path.length > 0) refs.push({ kind: "use", path });
  }
  return refs;
}

/** `src/a/b.rs` → каталог модуля `src/a`; `src/a/b/mod.rs` → `src/a/b`. */
export function rustModuleDirectory(filePath: string): string {
  if (filePath.endsWith("/mod.rs")) return parentPath(filePath);
  return parentPath(filePath);
}

function depthOf(path: string): number {
  return path === "" ? 0 : path.split("/").length;
}

async function walk(rootPath: string, startRel: string, maxFiles: number): Promise<{ files: FileEntry[]; directories: DirectoryEntry[]; truncated: boolean }> {
  const files: FileEntry[] = [];
  const directories: DirectoryEntry[] = [];
  let truncated = false;
  const absoluteStart = startRel ? resolve(rootPath, startRel) : rootPath;

  async function visit(absoluteDir: string, relDir: string, parent: string | null): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const relDirPosix = toPosix(relDir);
    if (relDirPosix !== "") {
      const isCrate = entries.some((entry) => entry.isFile() && entry.name === "Cargo.toml");
      const isModule = entries.some((entry) => entry.isFile() && /^index\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(entry.name));
      directories.push({
        path: relDirPosix,
        name: relDirPosix.split("/").pop() ?? relDirPosix,
        parent,
        depth: depthOf(relDirPosix),
        kind: isCrate ? "crate" : isModule ? "module" : "dir"
      });
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".git")) continue;
        await visit(join(absoluteDir, entry.name), relDir ? `${relDir}/${entry.name}` : entry.name, relDirPosix || null);
        continue;
      }
      if (!entry.isFile()) continue;
      const absoluteFile = join(absoluteDir, entry.name);
      let size = 0;
      try {
        size = (await fs.stat(absoluteFile)).size;
      } catch {
        continue;
      }
      files.push({ path: relDir ? `${relDir}/${entry.name}` : entry.name, size });
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  const relStart = startRel.replace(/^\/+|\/+$/g, "");
  await visit(absoluteStart, relStart, null);
  return { files, directories, truncated };
}

/** Полный анализ: карта файлов/каталогов и рёбра импортов. */
export async function analyzeRepository(input: AnalyzeInput): Promise<AnalyzeResult> {
  const maxFiles = input.maxFiles ?? MAX_FILES_DEFAULT;
  const startRel = (input.subPath ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const { files, directories, truncated } = await walk(input.rootPath, startRel, maxFiles);
  const fileSet = new Set(files.map((file) => file.path));

  const nodes: ArchitectNode[] = [];
  const edges: ArchitectEdge[] = [];
  const launches: ArchitectLaunch[] = [];
  const edgeIds = new Set<string>();
  const pushEdge = (from: string, to: string, external: boolean): void => {
    const key = `${from}->${to}`;
    if (edgeIds.has(key)) return;
    edgeIds.add(key);
    edges.push({ id: key, from, to, kind: "import", external });
  };

  for (const file of files) {
    nodes.push({
      id: file.path,
      name: file.path.split("/").pop() ?? file.path,
      kind: "file",
      path: file.path,
      parentId: parentPath(file.path) || null,
      depth: depthOf(file.path),
      fileCount: 1,
      sizeBytes: file.size,
      x: null,
      y: null
    });
  }
  for (const directory of directories) {
    nodes.push({
      id: directory.path,
      name: directory.name,
      kind: directory.kind,
      path: directory.path,
      parentId: directory.parent,
      depth: directory.depth,
      fileCount: 0,
      sizeBytes: 0,
      x: null,
      y: null
    });
  }

  // Агрегаты каталогов считаются снизу вверх: сначала файлы, затем каждый родитель.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const file of files) {
    let current = parentPath(file.path);
    while (current) {
      const node = byId.get(current);
      if (node) {
        node.fileCount += 1;
        node.sizeBytes += file.size;
      }
      current = parentPath(current);
    }
  }

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) continue;
    let source: string;
    try {
      source = await fs.readFile(join(input.rootPath, file.path), "utf8");
    } catch {
      continue;
    }
    launches.push(...extractLaunchPoints(file.path, source));
    if (isTsFile(file.path)) {
      for (const specifier of extractTsImports(source)) {
        const target = resolveTsImport(file.path, specifier, fileSet);
        if (target) pushEdge(file.path, target, false);
        else if (!specifier.startsWith(".") && !specifier.startsWith("/")) pushEdge(file.path, `external:${externalPackageName(specifier)}`, true);
      }
    } else if (isRustFile(file.path)) {
      const moduleDir = rustModuleDirectory(file.path);
      const crateRoot = rustCrateSourceRoot(file.path);
      for (const ref of extractRustModuleRefs(source)) {
        const target =
          ref.kind === "mod"
            ? findRustModuleFile(moduleDir, ref.path, fileSet)
            : findRustUseTarget(ref.path, crateRoot, fileSet);
        if (target) pushEdge(file.path, target, false);
      }
    }
  }

  const present = new Set(nodes.map((node) => node.id));
  const cleanEdges = edges.filter((edge) => edge.external || present.has(edge.to));
  const metrics: ArchitectMetrics = {
    files: files.length,
    directories: directories.length,
    modules: directories.filter((directory) => directory.kind === "module").length,
    crates: directories.filter((directory) => directory.kind === "crate").length,
    edges: cleanEdges.length,
    internalEdges: cleanEdges.filter((edge) => !edge.external).length,
    externalEdges: cleanEdges.filter((edge) => edge.external).length,
    bytes: files.reduce((sum, file) => sum + file.size, 0)
  };
  return { nodes, edges: cleanEdges, metrics, truncated, launches };
}

/** `crates/foo/src/lib.rs` → `crates/foo/src`; `src/main.rs` → `src`; иначе корень репозитория. */
export function rustCrateSourceRoot(filePath: string): string {
  const index = filePath.indexOf("/src/");
  if (index >= 0) return filePath.slice(0, index + 4);
  if (filePath.startsWith("src/")) return "src";
  return "";
}

function findRustModuleFile(moduleDir: string, modulePath: string[], files: ReadonlySet<string>): string | null {
  const base = moduleDir ? `${moduleDir}/${modulePath.join("/")}` : modulePath.join("/");
  for (const candidate of [`${base}.rs`, `${base}/mod.rs`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/** `use crate::a::b::C` → ищем `a/b.rs`, `a/b/mod.rs`, затем `a.rs`. */
function findRustUseTarget(usePath: string[], crateRoot: string, files: ReadonlySet<string>): string | null {
  const parts = [...usePath];
  if (parts[0] === "crate" || parts[0] === "") parts.shift();
  const root = crateRoot || "";
  for (let length = parts.length; length > 0; length -= 1) {
    const base = [root, parts.slice(0, length).join("/")].filter(Boolean).join("/");
    for (const candidate of [`${base}.rs`, `${base}/mod.rs`]) {
      if (files.has(candidate)) return candidate;
    }
  }
  return null;
}

/** Путь подкаталога внутри репозитория без выхода за корень (`..`, абсолютные пути, symlink-обход — операционная система). */
export function normalizeSubPath(rootPath: string, subPath: string): string {
  const normalized = subPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (normalized === "") return "";
  if (normalized.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("Путь карты не может выходить за пределы репозитория");
  }
  const absolute = resolve(rootPath, normalized);
  const rel = relative(rootPath, absolute);
  if (rel.startsWith("..") || rel === "..") throw new Error("Путь карты не может выходить за пределы репозитория");
  return toPosix(rel);
}
