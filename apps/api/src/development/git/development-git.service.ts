import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import {
  type CreateDevelopmentRepositoryInput,
  type DevelopmentGitCompare,
  type DevelopmentGitGraph,
  type DevelopmentGitGraphQuery,
  type DevelopmentGitCompareQuery,
  type DevelopmentRepository,
  type DevelopmentRepositoryRoots,
  type UpdateDevelopmentRepositoryInput
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import {
  GIT_HISTORY_FETCH_CAP,
  configuredRepositoryRoots,
  resolveCommitSha,
  resolveRepositoryPath,
  runGit
} from "./git-command";
import {
  COMMIT_FIELD_SEPARATOR as FIELD,
  GIT_LOG_FORMAT,
  GIT_LOG_FILES_FORMAT,
  parseBranches,
  parseGitLog,
  parseGitLogFiles,
  parseNumstat,
  parseTags,
  windowCommits,
  type GitFileActivity
} from "./git-graph-parser";

type DbClient = Prisma.TransactionClient;

interface CachedHistory {
  signature: string;
  commits: ReturnType<typeof parseGitLog>;
}

const MAX_CACHED_HISTORIES = 12;

/**
 * Git Workspace (11.1): список разрешённых репозиториев пространства и чтение их истории.
 *
 * Кэш — в памяти процесса и только для уже разобранной истории: ключ включает подпись `.git`
 * (mtime HEAD/index/packed-refs/refs/reflog), поэтому новый коммит, переключение ветки или
 * `git gc` инвалидируют запись сами. Между перезапусками ничего не сохраняется — это чтение,
 * а не второй источник истины о коде.
 */
@Injectable()
export class DevelopmentGitService {
  private readonly histories = new Map<string, CachedHistory>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  // ── репозитории ────────────────────────────────────────────────────────────────────────────────

  async listRepositories(userId: string, workspaceId: string): Promise<DevelopmentRepository[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.developmentGitRepository.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
      return rows.map(toRepositoryDto);
    });
  }

  /**
   * Регистрация репозитория. Путь проверяется на принадлежность разрешённому корню и на то, что
   * это рабочая копия git, ДО записи; канонический `realpath` сохраняется, а не введённая строка.
   */
  async registerRepository(userId: string, workspaceId: string, input: CreateDevelopmentRepositoryInput): Promise<DevelopmentRepository> {
    const checked = await this.checkRepositoryPath(input.path);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const exists = await tx.developmentGitRepository.findFirst({ where: { workspaceId, path: checked.path } });
      if (exists) throw new ConflictException("Этот репозиторий уже добавлен в пространство");
      const row = await tx.developmentGitRepository.create({
        data: { workspaceId, name: input.name, path: checked.path, taskRefPrefix: input.taskRefPrefix }
      });
      return toRepositoryDto(row);
    });
  }

  /** Меняются только подпись и конвенция ссылок; путь остаётся тем, что проверен при регистрации. */
  async updateRepository(userId: string, workspaceId: string, repositoryId: string, input: UpdateDevelopmentRepositoryInput): Promise<DevelopmentRepository> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      await this.requireRepositoryTx(tx, workspaceId, repositoryId);
      const row = await tx.developmentGitRepository.update({
        where: { id: repositoryId },
        data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.taskRefPrefix !== undefined ? { taskRefPrefix: input.taskRefPrefix } : {}) }
      });
      return toRepositoryDto(row);
    });
  }

  async removeRepository(userId: string, workspaceId: string, repositoryId: string): Promise<void> {    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const row = await tx.developmentGitRepository.findFirst({ where: { id: repositoryId, workspaceId } });
      if (!row) throw new NotFoundException("Репозиторий не найден");
      // Удаляется только запись: каталог на диске и привязки коммитов к задачам остаются.
      await tx.developmentGitRepository.delete({ where: { id: row.id } });
    });
  }

  /**
   * Разрешённые корни из настроек сервера. Это не секрет: они только сужают, какие пути сервер
   * вообще примет, и подсказывают пользователю, откуда можно регистрировать репозитории.
   */
  async allowedRoots(userId: string, workspaceId: string): Promise<DevelopmentRepositoryRoots> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    });
    return { roots: configuredRepositoryRoots() };
  }

  /** Репозиторий этого пространства; для чужих/несуществующих — 404, без утечки существования. */
  async requireRepositoryTx(tx: DbClient, workspaceId: string, repositoryId: string) {
    const row = await tx.developmentGitRepository.findFirst({ where: { id: repositoryId, workspaceId } });
    if (!row) throw new NotFoundException("Репозиторий не найден");
    return row;
  }

  // ── граф ──────────────────────────────────────────────────────────────────────────────────────

  async graph(userId: string, workspaceId: string, repositoryId: string, query: DevelopmentGitGraphQuery): Promise<DevelopmentGitGraph> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.requireRepositoryTx(tx, workspaceId, repositoryId);
    });
    const repoPath = await this.usablePath(row.path);
    try {
      const [branches, tags, head, branch, history] = await Promise.all([
        this.branches(repoPath),
        this.tags(repoPath),
        this.headSha(repoPath),
        this.currentBranch(repoPath),
        this.commits(repoPath, query.branch)
      ]);
      const window = windowCommits({
        commits: history,
        limit: query.limit,
        cursor: query.cursor,
        author: query.author,
        from: query.from,
        to: query.to
      });
      return {
        repository: { id: row.id, name: row.name, path: row.path },
        head,
        branch,
        branches,
        tags,
        commits: window.commits,
        merges: window.commits.filter((commit) => commit.isMerge).map((commit) => commit.sha),
        pullRequest: null,
        truncated: window.truncated,
        nextCursor: window.nextCursor,
        total: window.total,
        filters: {
          branch: query.branch ?? null,
          author: query.author ?? null,
          from: query.from ?? null,
          to: query.to ?? null
        }
      };
    } catch (error) {
      throw this.readFailure(error);
    }
  }

  async compare(userId: string, workspaceId: string, repositoryId: string, query: DevelopmentGitCompareQuery): Promise<DevelopmentGitCompare> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.requireRepositoryTx(tx, workspaceId, repositoryId);
    });
    const repoPath = await this.usablePath(row.path);
    try {
      const fromSha = await resolveCommitSha(repoPath, query.from);
      const toSha = await resolveCommitSha(repoPath, query.to);
      if (!fromSha) throw new BadRequestException(`Ссылка «${query.from}» не найдена в репозитории`);
      if (!toSha) throw new BadRequestException(`Ссылка «${query.to}» не найдена в репозитории`);
      const [log, numstat, counts] = await Promise.all([
        runGit(repoPath, ["log", "--date-order", "--max-count=500", `--pretty=format:${GIT_LOG_FORMAT}`, `${fromSha}..${toSha}`, "--"]),
        runGit(repoPath, ["diff", "--numstat", fromSha, toSha, "--"]),
        runGit(repoPath, ["rev-list", "--left-right", "--count", `${fromSha}...${toSha}`])
      ]);
      const [behind, ahead] = (counts.trim().split(/\s+/).map((value) => Number(value) || 0));
      return {
        repository: { id: row.id, name: row.name },
        from: { ref: query.from, sha: fromSha },
        to: { ref: query.to, sha: toSha },
        commits: parseGitLog(log),
        files: parseNumstat(numstat),
        ahead: ahead ?? 0,
        behind: behind ?? 0
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw this.readFailure(error);
    }
  }

  /** Один коммит по ссылке/sha — для ручной привязки к задаче; `null`, если такого коммита нет. */
  async findCommit(repoPath: string, ref: string) {
    const sha = await resolveCommitSha(repoPath, ref);
    if (!sha) return null;
    const log = await runGit(repoPath, ["log", "-1", `--pretty=format:${GIT_LOG_FORMAT}`, sha, "--"]);
    return parseGitLog(log)[0] ?? null;
  }

  /** История для поиска ссылок `#<задача>`: без кэша, чтобы разовая синхронизация видела свежий `.git`. */
  async recentCommits(repoPath: string, limit = 500) {
    const log = await runGit(repoPath, ["log", "--all", "--date-order", `--max-count=${Math.min(limit, GIT_HISTORY_FETCH_CAP)}`, `--pretty=format:${GIT_LOG_FORMAT}`, "--"]);
    return parseGitLog(log);
  }

  /** Последний коммит для каждого файла среди последних `maxCount` коммитов; можно по ревизии. */
  async recentCommitFiles(repoPath: string, ref?: string, maxCount = 300): Promise<Map<string, GitFileActivity>> {
    const args = ["log", `--max-count=${Math.min(Math.max(maxCount, 1), GIT_HISTORY_FETCH_CAP)}`, `--pretty=format:${GIT_LOG_FILES_FORMAT}`];
    if (ref) {
      const sha = await resolveCommitSha(repoPath, ref);
      if (!sha) throw new BadRequestException(`Ссылка «${ref}» не найдена в репозитории`);
      args.push(sha);
    }
    args.push("--name-only", "--");
    return parseGitLogFiles(await runGit(repoPath, args));
  }

  // ── чтение git ────────────────────────────────────────────────────────────────────────────────

  private async branches(repoPath: string) {
    // `%x1f` раскрывается только в pretty-формате `git log`; здесь разделитель — буквальный символ.
    const out = await runGit(repoPath, [
      "for-each-ref",
      `--format=%(refname:short)${FIELD}%(objectname)${FIELD}%(committerdate:iso-strict)${FIELD}%(HEAD)`,
      "refs/heads"
    ]);
    return parseBranches(out);
  }

  private async tags(repoPath: string) {
    const out = await runGit(repoPath, [
      "for-each-ref",
      `--format=%(refname:short)${FIELD}%(objectname)${FIELD}%(objecttype)${FIELD}%(*objectname)`,
      "refs/tags"
    ]);
    return parseTags(out);
  }

  private async headSha(repoPath: string): Promise<string | null> {
    try {
      const sha = (await runGit(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim();
      return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    } catch {
      return null; // пустой репозиторий — это не ошибка
    }
  }

  private async currentBranch(repoPath: string): Promise<string | null> {
    try {
      const name = (await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      return name && name !== "HEAD" ? name : null;
    } catch {
      return null;
    }
  }

  /**
   * История одной ветки (или всех ссылок). Кэш живёт до изменения подписи `.git`; потолок
   * `GIT_HISTORY_FETCH_CAP` защищает от репозитория на сотни тысяч коммитов.
   */
  private async commits(repoPath: string, branch?: string) {
    if (branch) {
      const branchSha = await resolveCommitSha(repoPath, branch);
      if (!branchSha) throw new BadRequestException(`Ветка или ссылка «${branch}» не найдена`);
    }
    const signature = await this.gitSignature(repoPath);
    const key = `${repoPath}\0${branch ?? "*"}`;
    const cached = this.histories.get(key);
    if (cached?.signature === signature) return cached.commits;

    const args = ["log", "--date-order", `--max-count=${GIT_HISTORY_FETCH_CAP}`, `--pretty=format:${GIT_LOG_FORMAT}`];
    if (branch) args.push(branch);
    else args.push("--all");
    args.push("--");
    const commits = parseGitLog(await runGit(repoPath, args));
    this.remember(key, { signature, commits });
    return commits;
  }

  private remember(key: string, value: CachedHistory): void {
    this.histories.set(key, value);
    if (this.histories.size <= MAX_CACHED_HISTORIES) return;
    const oldest = this.histories.keys().next().value;
    if (oldest !== undefined) this.histories.delete(oldest);
  }

  /**
   * Подпись состояния `.git`: `HEAD`, `index`, `packed-refs`, каталог `refs` и reflog. Именно эти
   * файлы меняются при коммите/переключении ветки, поэтому кэш не может отдать устаревший граф.
   */
  private async gitSignature(repoPath: string): Promise<string> {
    let gitDir: string;
    try {
      gitDir = (await runGit(repoPath, ["rev-parse", "--absolute-git-dir"])).trim();
    } catch {
      return `unavailable:${Date.now()}`;
    }
    const parts: string[] = [];
    for (const relative of ["HEAD", "index", "packed-refs", "refs", "logs/HEAD", "logs/refs"]) {
      try {
        const stat = await fs.stat(join(gitDir, relative));
        parts.push(`${relative}:${stat.mtimeMs}:${stat.size}`);
      } catch {
        parts.push(`${relative}:-`);
      }
    }
    return parts.join("|");
  }

  // ── путь ──────────────────────────────────────────────────────────────────────────────────────

  /** Путь проверяется заново при каждом чтении: корень могли убрать из настроек уже после регистрации. */
  async usablePath(storedPath: string): Promise<string> {
    try {
      return (await resolveRepositoryPath(storedPath, configuredRepositoryRoots())).path;
    } catch (error) {
      throw new ConflictException(`Репозиторий недоступен: ${(error as Error).message}`);
    }
  }

  private async checkRepositoryPath(path: string): Promise<{ path: string }> {
    try {
      return await resolveRepositoryPath(path, configuredRepositoryRoots());
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private readFailure(error: unknown): Error {
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ConflictException) return error;
    return new BadRequestException(`Не удалось прочитать репозиторий: ${(error as Error).message}`);
  }
}

function toRepositoryDto(row: {
  id: string;
  name: string;
  path: string;
  taskRefPrefix: string;
  createdAt: Date;
  updatedAt: Date;
}): DevelopmentRepository {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    taskRefPrefix: row.taskRefPrefix,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
