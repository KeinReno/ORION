import { describe, expect, it } from "vitest";
import {
  COMMIT_FIELD_SEPARATOR,
  COMMIT_RECORD_SEPARATOR,
  parseBranches,
  parseGitLog,
  parseNumstat,
  parseTags,
  windowCommits,
  type GraphWindowInput
} from "./git-graph-parser";
import type { DevelopmentGitCommit } from "@orion/shared-types";

const SEP = COMMIT_FIELD_SEPARATOR;
const END = COMMIT_RECORD_SEPARATOR;
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

function record(sha: string, parents: string[], author: string, email: string, date: string, refs: string, subject: string, body = subject): string {
  return [sha, parents.join(" "), author, email, date, refs, subject, body].join(SEP) + END;
}

describe("разбор git log", () => {
  it("читает коммиты, слияния, украшения и полное сообщение", () => {
    const output =
      record(B, [A], "Анна", "anna@example.test", "2026-11-01T10:00:00+03:00", "HEAD -> main, tag: v1", "Второй коммит", "Второй коммит\n\nТело") +
      record(A, [], "Борис", "boris@example.test", "2026-10-31T10:00:00+03:00", "", "Первый коммит");
    const commits = parseGitLog(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: B,
      parents: [A],
      author: "Анна",
      email: "anna@example.test",
      subject: "Второй коммит",
      message: "Второй коммит\n\nТело",
      isMerge: false,
      refs: ["HEAD -> main", "tag: v1"]
    });
    expect(commits[1]).toMatchObject({ sha: A, parents: [], isMerge: false, message: "Первый коммит" });
  });

  it("слияние — коммит с двумя родителями", () => {
    const commits = parseGitLog(record(C, [A, B], "Анна", "a@e.t", "2026-11-02T10:00:00Z", "", "Merge feature"));
    expect(commits[0]!.isMerge).toBe(true);
    expect(commits[0]!.parents).toEqual([A, B]);
  });

  it("мусор и обрезанные записи не превращаются в коммиты", () => {
    expect(parseGitLog("")).toEqual([]);
    expect(parseGitLog(`не sha${SEP}${SEP}${SEP}${SEP}${SEP}${SEP}${SEP}${END}`)).toEqual([]);
    expect(parseGitLog(`${A}${SEP}${SEP}${SEP}${SEP}${SEP}${SEP}${SEP}${END}`)).toHaveLength(1);
  });
});

describe("ветки, теги, diffstat", () => {
  it("текущая ветка помечается звёздочкой git", () => {
    const output = [
      ["main", A, "2026-11-02T10:00:00+03:00", "*"].join(SEP),
      ["feature", B, "2026-11-01T10:00:00+03:00", " "].join(SEP)
    ].join("\n");
    expect(parseBranches(output)).toEqual([
      { name: "main", sha: A, isCurrent: true, updatedAt: "2026-11-02T10:00:00+03:00" },
      { name: "feature", sha: B, isCurrent: false, updatedAt: "2026-11-01T10:00:00+03:00" }
    ]);
  });

  it("аннотированный тег указывает на коммит, а не на объект тега", () => {
    const output = [
      ["v1.0", C, "tag", B].join(SEP),
      ["v0.9", A, "commit", ""].join(SEP)
    ].join("\n");
    expect(parseTags(output)).toEqual([
      { name: "v1.0", sha: B, annotated: true },
      { name: "v0.9", sha: A, annotated: false }
    ]);
  });

  it("numstat: добавления/удаления и двоичные файлы", () => {
    const output = ["12\t3\tsrc/a.ts", "-\t-\tassets/logo.png", "0\t5\tREADME.md", ""].join("\n");
    expect(parseNumstat(output)).toEqual([
      { path: "src/a.ts", additions: 12, deletions: 3, binary: false },
      { path: "assets/logo.png", additions: 0, deletions: 0, binary: true },
      { path: "README.md", additions: 0, deletions: 5, binary: false }
    ]);
  });
});

describe("окно истории: фильтры и пагинация по sha", () => {
  const commits: DevelopmentGitCommit[] = [
    { sha: D, parents: [C], author: "Анна", email: "anna@example.test", date: "2026-11-04T10:00:00Z", subject: "d", message: "d", isMerge: false, refs: [] },
    { sha: C, parents: [B], author: "Борис", email: "boris@example.test", date: "2026-11-03T10:00:00Z", subject: "c", message: "c", isMerge: false, refs: [] },
    { sha: B, parents: [A], author: "Анна", email: "anna@example.test", date: "2026-11-02T10:00:00Z", subject: "b", message: "b", isMerge: true, refs: [] },
    { sha: A, parents: [], author: "Борис", email: "boris@example.test", date: "2026-11-01T10:00:00Z", subject: "a", message: "a", isMerge: false, refs: [] }
  ];

  function window(input: Partial<GraphWindowInput>) {
    return windowCommits({ commits, limit: 2, ...input });
  }

  it("первая страница, курсор — последний отданный sha", () => {
    const first = window({});
    expect(first.commits.map((commit) => commit.sha)).toEqual([D, C]);
    expect(first.nextCursor).toBe(C);
    expect(first.truncated).toBe(true);
    expect(first.total).toBe(4);
    const second = window({ cursor: first.nextCursor! });
    expect(second.commits.map((commit) => commit.sha)).toEqual([B, A]);
    expect(second.nextCursor).toBeNull();
    expect(second.truncated).toBe(false);
  });

  it("фильтр по автору и датам не ломает курсор", () => {
    const byAuthor = window({ author: "анна", limit: 10 });
    expect(byAuthor.commits.map((commit) => commit.sha)).toEqual([D, B]);
    expect(byAuthor.total).toBe(2);

    const byDate = window({ from: "2026-11-02T00:00:00Z", to: "2026-11-03T23:59:59Z", limit: 10 });
    expect(byDate.commits.map((commit) => commit.sha)).toEqual([C, B]);
  });

  it("неизвестный курсор — ошибка, а не молчаливая первая страница", () => {
    expect(() => window({ cursor: "f".repeat(40) })).toThrow("Курсор пагинации не найден");
  });
});
