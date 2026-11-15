import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { resolveCommitSha, runGit } from "../git/git-command";

export interface PreparedAnalysisRoot {
  /** Каталог с состоянием репозитория на запрошенной ревизии. */
  rootPath: string;
  /** Удаляет временный каталог; вызывать в `finally`, чтобы не остаться с мусором в temp. */
  cleanup: () => Promise<void>;
}

/**
 * Разбор tar-архива (`git archive`) без внешних зависимостей. Поддерживает ustar-записи,
 * GNU longname (`L`) и pax-заголовки (`x`) с полем `path` — всё, что реально пишет git.
 * Записи с выходом за пределы каталога (`..`) отбрасываются.
 */
export async function extractTar(archivePath: string, destDir: string): Promise<void> {
  const buffer = await fs.readFile(archivePath);
  const text = (header: Buffer, start: number, length: number) => header.toString("utf8", start, start + length).replace(/\0.*$/u, "");
  let offset = 0;
  let pendingName: string | null = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(byte => byte === 0)) break;
    const type = header[156];
    const size = Number.parseInt(text(header, 124, 12).trim(), 8) || 0;
    const padded = Math.ceil(size / 512) * 512;
    if (type === 76 /* "L" GNU longname */ || type === 75 /* "K" longlink */) {
      pendingName = buffer.toString("utf8", offset, offset + size).replace(/\0.*$/u, "");
    } else if (type === 120 /* "x" pax */) {
      const body = buffer.toString("utf8", offset, offset + size);
      const match = /(?:^|\n)\d+ path=([^\n]*)/u.exec(body);
      if (match) pendingName = match[1];
    } else if (type === 0 || type === 48 /* '0' файл */) {
      const name = pendingName ?? tarEntryName(header, text);
      pendingName = null;
      if (safeRelative(name)) {
        const target = join(destDir, name);
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, buffer.subarray(offset, offset + size));
      }
    } else if (type === 53 /* '5' каталог */) {
      const name = (pendingName ?? tarEntryName(header, text)).replace(/\/$/u, "");
      pendingName = null;
      if (safeRelative(name)) await fs.mkdir(join(destDir, name), { recursive: true });
    } else {
      pendingName = null; // symlink/прочее — анализатору файлы нужны, остальное игнорируем
    }
    offset += padded;
  }
}

function tarEntryName(header: Buffer, text: (header: Buffer, start: number, length: number) => string): string {
  const name = text(header, 0, 100);
  const magic = text(header, 257, 6);
  if (magic === "ustar") {
    const prefix = text(header, 345, 155).trim();
    return prefix ? `${prefix}/${name}` : name;
  }
  return name;
}

/** Имя внутри архива не должно выходить за пределы каталога назначения. */
function safeRelative(name: string): boolean {
  if (!name) return false;
  const normalized = normalize(name);
  return !isAbsolute(normalized) && normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

/**
 * Каталог с состоянием репозитория на ревизии `ref` для анализа. Исходный репозиторий не
 * изменяется: `git archive` читает объекты ревизии в tar-архив, тот разворачивается во временный
 * каталог. Один вызов git без дочерних процессов — работает и в ограниченных средах.
 */
export async function prepareAnalysisRoot(repoPath: string, ref: string): Promise<PreparedAnalysisRoot> {
  let sha: string | null = null;
  try {
    sha = await resolveCommitSha(repoPath, ref);
  } catch {
    sha = null;
  }
  if (!sha) throw new Error(`Ссылка «${ref}» не найдена в репозитории`);
  const tmp = await fs.mkdtemp(join(tmpdir(), "orion-architect-"));
  try {
    const archivePath = join(tmp, ".orion-archive.tar");
    await runGit(repoPath, ["archive", "--format=tar", `--output=${archivePath}`, sha], { timeoutMs: 120_000 });
    await extractTar(archivePath, tmp);
    await fs.rm(archivePath, { force: true });
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    rootPath: tmp,
    cleanup: async () => { await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined); }
  };
}
