import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Обёртка над системным `git` (11.1) и единственное место, где решается, КАКОЙ каталог вообще можно
 * читать. Git запускается без оболочки (`execFile`, не `exec`), поэтому путь и refs не могут стать
 * командой; дополнительно всё, что похоже на флаг, отвергается до вызова.
 *
 * Разрешённые корни задаёт владелец узла переменной окружения `ORION_DEV_REPOSITORY_ROOTS`
 * (`;` или перевод строки между путями). Пользовательский запрос несёт только id уже
 * зарегистрированного репозитория; произвольный путь с клиента в `git` не попадает.
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

/** `candidate` лежит внутри `root` (или совпадает); сравнение регистронезависимо на Windows. */
export function isInsideRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export interface RepositoryPathCheck {
  /** Канонический абсолютный путь (после `realpath`), именно он хранится в БД. */
  path: string;
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
  if (roots.length === 0) {
    throw new Error("Разрешённые корни не заданы: укажите ORION_DEV_REPOSITORY_ROOTS на сервере");
  }
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
  const gitEntry = resolve(real, ".git");
  try {
    await fs.stat(gitEntry);
  } catch {
    throw new Error("В каталоге нет .git: это не рабочая копия репозитория");
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
