import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { moduleDocsProblems, packageMentionProblems } from "./module-docs.mjs";

const fixtures = [];
afterEach(() => {
  const safeRoot = realpathSync(tmpdir()) + sep;
  for (const dir of fixtures.splice(0)) {
    const actual = realpathSync(dir);
    if (!actual.startsWith(safeRoot) || !actual.includes("orion-module-docs-")) throw new Error("Unsafe test cleanup path");
    rmSync(actual, { recursive: true, force: true });
  }
});

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "orion-module-docs-"));
  fixtures.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe("module docs", () => {
  it("repository docs are up to date", () => {
    expect(moduleDocsProblems()).toEqual([]);
    expect(packageMentionProblems()).toEqual([]);
  });

  it("flags mentions of packages that do not exist unless marked as planned", () => {
    const dir = fixture({
      "packages/core/package.json": JSON.stringify({ name: "@orion/core" }),
      "docs/a.md": "use @orion/core and @orion/ghost-sdk\nlater @orion/other-sdk (планируется)\n"
    });
    const problems = packageMentionProblems(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("docs/a.md:1");
    expect(problems[0]).toContain("@orion/ghost-sdk");
  });
});
