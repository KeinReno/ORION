import clsx from "clsx";
import { useMemo } from "react";

export type DiffOp = "same" | "add" | "del";
export interface DiffRow {
  op: DiffOp;
  text: string;
}

/** Rough cap on the LCS grid (rows before × rows after) — bigger inputs use the cheap fallback. */
const LCS_CELL_BUDGET = 1_500_000;

/**
 * Line-level diff, no dependency. A standard LCS backtrack for normal note
 * bodies; for pathologically large inputs it degrades to common
 * prefix/suffix + a block replace, which is wrong in detail but never slow.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");

  if (a.length * b.length > LCS_CELL_BUDGET) {
    return cheapDiff(a, b);
  }

  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ op: "del", text: a[i] });
      i++;
    } else {
      rows.push({ op: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ op: "del", text: a[i++] });
  while (j < m) rows.push({ op: "add", text: b[j++] });
  return rows;
}

function cheapDiff(a: string[], b: string[]): DiffRow[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ op: "same", text: a[i] });
  for (let i = start; i < endA; i++) rows.push({ op: "del", text: a[i] });
  for (let j = start; j < endB; j++) rows.push({ op: "add", text: b[j] });
  for (let i = endA; i < a.length; i++) rows.push({ op: "same", text: a[i] });
  return rows;
}

/** Renders a line diff between `before` and `after` as a monospace gutter list. */
export function DiffView({
  before,
  after,
  className
}: {
  before: string;
  after: string;
  className?: string;
}): React.ReactElement {
  const rows = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <div className={clsx("orion-scroll overflow-auto rounded-lg border border-border bg-white/[0.02]", className)}>
      <pre className="min-w-full font-mono text-xs leading-relaxed">
        {rows.map((row, index) => (
          <div
            key={index}
            className={clsx(
              "flex gap-2 px-2",
              row.op === "add" && "bg-success/10 text-success",
              row.op === "del" && "bg-destructive/10 text-destructive",
              row.op === "same" && "text-muted-foreground"
            )}
          >
            <span aria-hidden className="select-none opacity-60">
              {row.op === "add" ? "+" : row.op === "del" ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-words">{row.text || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
