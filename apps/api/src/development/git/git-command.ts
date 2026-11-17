import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Обёртка над системным `git` (11.1) и единственное место, где решается, КАКОЙ каталог вообще можно
 * читать. Git запускается без оболочки (`execFile`, не `exec`), поэтому путь и refs не могут стать
 * командой; дополнительно всё, что похоже на флаг, отвергается до вызова.
 *
 * Разрешённые корни задаёт владелец узла переменной окружения `ORION_DEV_REPOSITORY_ROOTS`
 * (`;` или перевод строки между путями). Когда она не задана, разрешён домашний каталог
 * пользователя узла: локальный узел ORION (десктоп) не должен требовать настройки env для
 * первой регистрации. Пользовательский запрос несёт только id уже зарегистрированного
 * репозитория; произвольный путь с клиента в `git` не попадает.
 */

/** Потолок истории, которую сервер вообще готов разобрать за один вызов. */
export const GIT_HISTORY_FETCH_CAP = 2_000;
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    readonly code: number | null
  ) {
    super(`git ${args[0] ?? ""} завершился с ошибкой${code === null ? "" : ` (${code})`}: ${stderr.trim().slice(0, 500)}`);
    this.name = "GitCommandError";
  }
}

/** Разрешённые корни из окружения. Несуществующие/относительные пути не становятся корнем молча. */
export function configuredRepositoryRoots(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const raw = env.ORION_DEV_REPOSITORY_ROOTS ?? "";
  return raw
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(cwd, entry));
}

/**
 * Действующие корни: явные из `ORION_DEV_REPOSITORY_ROOTS`, а при их отсутствии — домашний
 * каталог пользователя узла. Явный список по-прежнему сужает доступ, когда администратор
 * его задал; умолчание существует, чтобы локальное приложение работало без настройки env.
 */
export function effectiveRepositoryRoots(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), home = homedir()): string[] {
  const configured = configuredRepositoryRoots(env, cwd);
  return configured.length > 0 ? configured : [resolve(cwd, home)];
}

/** `candidate` лежит внутри `root` (или совпадает); сравнение регистронезависимо на Windows. */
export function isInsideRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export interface RepositoryPathCheck {
  /** Канонический абсолютный путь (после `realpath`), именно он хранится в БД. */
  path: string;
}

async function assertInsideRepositoryRoots(real: string, roots: readonly string[]): Promise<void> {
  if (roots.length === 0) throw new Error("Разрешённые корни не заданы");
  const realRoots: string[] = [];
  for (const root of roots) {
    try {
      realRoots.push(await fs.realpath(resolve(root)));
    } catch {
      /* несуществующий корень не разрешает ничего */
    }
  }
  if (!realRoots.some((root) => isInsideRoot(real, root))) {
    throw new Error("Путь вне разрешённых корней репозиториев");
  }
}

/**
 * Проверка пути перед регистрацией: каталог существует, это действительно рабочая копия git и он
 * лежит внутри одного из разрешённых корней. Симлинки раскрываются ДО сравнения — иначе ссылка
 * внутри корня могла бы указывать наружу.
 */
export async function resolveRepositoryPath(rawPath: string, roots: readonly string[]): Promise<RepositoryPathCheck> {
  if (!rawPath || rawPath.includes("\0")) throw new Error("Путь к репозиторию пуст");
  if (!isAbsolute(rawPath)) throw new Error("Путь к репозиторию должен быть абсолютным");
  const requested = resolve(rawPath);
  let real: string;
  try {
    real = await fs.realpath(requested);
  } catch {
    throw new Error(`Каталог не найден: ${requested}`);
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error(`Это не каталог: ${real}`);
  await assertInsideRepositoryRoots(real, roots);
  const gitEntry = resolve(real, ".git");
  try {
    await fs.stat(gitEntry);
  } catch {
    throw new Error("В каталоге нет .git: это не рабочая копия репозитория");
  }
  return { path: real };
}

/**
 * Содержимое каталога для встроенного обзора (вместо нативного диалога — работает и в браузере).
 * Путь проверяется на принадлежность корням; ответ несёт только имена и признаки, нужные форме.
 */
export interface BrowseEntry { name: string; isGit: boolean; empty: boolean }

export async function browseDirectory(rawPath: string | null, roots: readonly string[]): Promise<{ path: string; parent: string | null; entries: BrowseEntry[] }> {
  const realRoots: string[] = [];
  for (const root of roots) {
    try {
      realRoots.push(await fs.realpath(resolve(root)));
    } catch {
      /* несуществующий корень не участвует в обзоре */
    }
  }
  let current: string;
  if (rawPath) {
    if (!isAbsolute(rawPath)) throw new Error("Путь должен быть абсолютным");
    let existing = resolve(rawPath);
    const tail: string[] = [];
    for (;;) {
      try {
        existing = await fs.realpath(existing);
        break;
      } catch {
        const parent = dirname(existing);
        if (parent === existing) throw new Error(`Каталог не найден: ${rawPath}`);
        tail.unshift(basename(existing));
        existing = parent;
      }
    }
    current = tail.length > 0 ? resolve(existing, ...tail) : existing;
    if (!realRoots.some((root) => isInsideRoot(current, root))) throw new Error("Путь вне разрешённых корней");
  } else {
    current = realRoots[0] ?? resolve(homedir());
  }
  const stat = await fs.stat(current).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Это не каталог: ${current}`);
  const names = await fs.readdir(current);
  const entries: BrowseEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".") && name !== ".git") continue;
    const full = join(current, name);
    try {
      const child = await fs.stat(full);
      if (!child.isDirectory()) continue;
      const children = await fs.readdir(full);
      entries.push({ name, isGit: children.includes(".git"), empty: children.filter((item) => item !== ".git").length === 0 });
    } catch {
      /* недоступный каталог пропускаем */
    }
  }
  entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const atRoot = realRoots.some((root) => current === root);
  return { path: current, parent: atRoot ? null : dirname(current), entries };
}

/**
 * Быстрый поиск существующих git-репозиториев рядом с разрешёнными корнями: сам корень
 * (если это рабочая копия) и его непосредственные подкаталоги с `.git`. Глубина — один
 * уровень, потолок — `limit` записей: это подсказка для формы, а не полный индекс диска.
 */
export async function findRepositoryCandidates(roots: readonly string[], limit = 30): Promise<Array<{ name: string; path: string }>> {
  const found: Array<{ name: string; path: string }> = [];
  const seen = new Set<string>();
  const consider = async (dir: string) => {
    if (found.length >= limit || seen.has(dir.toLowerCase())) return;
    try {
      await fs.stat(join(dir, ".git"));
    } catch {
      return;
    }
    seen.add(dir.toLowerCase());
    found.push({ name: basename(dir) || dir, path: dir });
  };
  for (const root of roots) {
    if (found.length >= limit) break;
    let realRoot: string;
    try {
      realRoot = await fs.realpath(resolve(root));
    } catch {
      continue;
    }
    await consider(realRoot);
    if (found.length >= limit) break;
    let entries;
    try {
      entries = await fs.readdir(realRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      await consider(join(realRoot, entry.name));
    }
  }
  return found.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/**
 * Проверка пути для «создать с нуля». Существующая часть пути каноникализируется realpath'ем
 * (симлинки раскрываются до сравнения с корнями), несуществующий хвост будет создан ниже.
 * Существующий каталог обязан быть пустым (допустимо лишь переинициализировать папку, где уже
 * есть `.git`).
 */
export async function resolveInitRepositoryPath(rawPath: string, roots: readonly string[]): Promise<RepositoryPathCheck> {
  if (!rawPath || rawPath.includes("\0")) throw new Error("Путь к репозиторию пуст");
  if (!isAbsolute(rawPath)) throw new Error("Путь к репозиторию должен быть абсолютным");
  const requested = resolve(rawPath);
  let existing = requested;
  const tail: string[] = [];
  for (;;) {
    try {
      existing = await fs.realpath(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) throw new Error(`Каталог не найден: ${requested}`);
      tail.unshift(basename(existing));
      existing = parent;
    }
  }
  const real = tail.length > 0 ? resolve(existing, ...tail) : existing;
  await assertInsideRepositoryRoots(real, roots);
  if (tail.length === 0) {
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new Error(`Это не каталог: ${real}`);
    const entries = (await fs.readdir(real)).filter((entry) => entry !== ".git");
    if (entries.length > 0) throw new Error("Каталог не пуст: выберите пустую папку или существующий git-репозиторий");
  }
  return { path: real };
}

export interface GitRunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Один вызов `git -C <repo> …`. Всегда без интерактивного ввода (иначе fetch-хук или запрос пароля
 * мог бы подвесить запрос), с ограничением времени и размера вывода.
 */
export function runGit(repoPath: string, args: readonly string[], options: GitRunOptions = {}): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      ["-C", repoPath, ...args],
      {
        timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER,
        windowsHide: true,
        env: {
          ...process.env,
          ...options.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "cat",
          LC_ALL: "C",
          LANG: "C"
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : null;
          rejectPromise(new GitCommandError(args, stderr || error.message, code));
          return;
        }
        resolvePromise(stdout);
      }
    );
  });
}

/** Ссылка (ветка/тег/commit-ish) без пробелов и управляющих символов; флагом быть не может. */
export function assertSafeGitRef(ref: string): string {
  if (!ref || ref.startsWith("-") || /[\s\0]/.test(ref) || ref.length > 255) {
    throw new Error("Недопустимое имя ссылки");
  }
  return ref;
}

/** Полный sha коммита, к которому ведёт `ref`, или `null`, если такой ссылки нет. */
export async function resolveCommitSha(repoPath: string, ref: string): Promise<string | null> {
  try {
    const out = await runGit(repoPath, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${assertSafeGitRef(ref)}^{commit}`]);
    const sha = out.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
