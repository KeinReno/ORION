import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXTENSION_MANIFEST_FILE,
  extensionManifestSchema,
  satisfiesVersionRange,
  type ExtensionManifest,
  type ExtensionStatus
} from "@orion/shared-types";

/**
 * Чистая часть загрузчика расширений (ADR-0022, E2): где папка, что в ней лежит, что с этим можно делать. Без Nest и БД,
 * чтобы проверять юнит-тестами на временном каталоге.
 */

/** Код расширения больше этого — почти наверняка ошибка сборки (в бандл попал React или карта исходников). */
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

/** `Документы\ORION\Расширения` (решение владельца); переопределяется `ORION_EXTENSIONS_DIR`. */
export function extensionsDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const fromEnv = env.ORION_EXTENSIONS_DIR?.trim();
  return path.resolve(fromEnv || path.join(home, "Documents", "ORION", "Расширения"));
}

export interface ScannedExtension {
  /** id из манифеста; если манифест не читается — имя папки. */
  id: string;
  folder: string;
  manifest: ExtensionManifest | null;
  problems: string[];
  /** sha-256 манифеста и кода; null, если файлов нет. */
  sha256: string | null;
  entryFile: string | null;
}

export interface ExtensionApproval {
  version: string;
  sha256: string;
  enabled: boolean;
  devMode: boolean;
  approvedBy: string;
  approvedAt: string;
  /** Пространства, где расширение выключено (E5). Нет поля — работает везде. */
  disabledWorkspaces?: string[];
}

/** Хеш содержимого: манифест и код вместе — подтверждают именно эту пару. */
export function contentHash(manifestBytes: Buffer, entryBytes: Buffer): string {
  return createHash("sha256").update(manifestBytes).update("\0").update(entryBytes).digest("hex");
}

/**
 * Читает все папки каталога. `reservedIds` — id модулей и плагинов основной сборки: расширение не может выдать себя за них
 * (места регистрируются от имени `pluginId`).
 */
export function scanExtensions(dir: string, reservedIds: ReadonlySet<string>): ScannedExtension[] {
  if (!fs.existsSync(dir)) return [];
  const result: ScannedExtension[] = [];
  const seen = new Map<string, ScannedExtension>();
  const folders = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const folder of folders) {
    const base = path.join(dir, folder);
    const scanned: ScannedExtension = { id: folder, folder, manifest: null, problems: [], sha256: null, entryFile: null };
    result.push(scanned);
    const manifestPath = path.join(base, EXTENSION_MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
      scanned.problems.push(`нет файла ${EXTENSION_MANIFEST_FILE}`);
      continue;
    }
    const manifestBytes = fs.readFileSync(manifestPath);
    let raw: unknown;
    try {
      // trimStart() also drops a byte-order mark: Notepad on Windows saves UTF-8 with one.
      raw = JSON.parse(manifestBytes.toString("utf8").trimStart());
    } catch (error) {
      scanned.problems.push(`${EXTENSION_MANIFEST_FILE} — не JSON (${(error as Error).message})`);
      continue;
    }
    const parsed = extensionManifestSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) scanned.problems.push(`${issue.path.join(".") || "манифест"}: ${issue.message}`);
      continue;
    }
    const manifest = parsed.data;
    scanned.id = manifest.id;
    scanned.manifest = manifest;
    if (manifest.id !== folder) scanned.problems.push(`id «${manifest.id}» не совпадает с именем папки «${folder}»`);
    if (reservedIds.has(manifest.id)) scanned.problems.push(`id «${manifest.id}» занят встроенным модулем или плагином ORION`);
    const twin = seen.get(manifest.id);
    if (twin) scanned.problems.push(`id «${manifest.id}» уже у папки «${twin.folder}»`);
    else seen.set(manifest.id, scanned);

    const entryFile = path.join(base, manifest.entry);
    if (!fs.existsSync(entryFile)) {
      scanned.problems.push(`нет файла кода ${manifest.entry} — соберите расширение (orion-ext build)`);
      continue;
    }
    const entryBytes = fs.readFileSync(entryFile);
    if (entryBytes.length > MAX_ENTRY_BYTES) scanned.problems.push(`${manifest.entry} больше 5 МБ — в сборку, вероятно, попал React или карта исходников`);
    scanned.entryFile = entryFile;
    scanned.sha256 = contentHash(manifestBytes, entryBytes);
  }
  return result;
}

/** Состояние расширения из того, что лежит в папке, и того, что подтверждали. */
export function statusOf(scanned: ScannedExtension, approval: ExtensionApproval | undefined, platformVersion: string): ExtensionStatus {
  if (!scanned.manifest || scanned.problems.length > 0 || !scanned.sha256) return "invalid";
  if (!satisfiesVersionRange(scanned.manifest.engines.orion, platformVersion)) return "incompatible";
  if (!approval) return "pending";
  if (!approval.enabled) return "disabled";
  if (approval.sha256 !== scanned.sha256 && !approval.devMode) return "changed";
  return "approved";
}

/** Дешёвый «отпечаток» каталога (имена, размеры, время изменения) — по его смене интерфейс перезагружает расширения. */
export function folderFingerprint(dir: string): string {
  if (!fs.existsSync(dir)) return "missing";
  const parts: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = path.join(dir, entry.name);
    for (const file of fs.readdirSync(base, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const stat = fs.statSync(path.join(base, file.name));
      parts.push(`${entry.name}/${file.name}:${stat.size}:${stat.mtimeMs}`);
    }
  }
  return parts.sort().join("|");
}
