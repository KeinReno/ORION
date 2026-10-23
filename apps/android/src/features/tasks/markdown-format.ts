export type MarkdownFormat = "bold" | "italic" | "heading" | "list" | "quote";
export interface TextRange { value: string; start: number; end: number }

const INLINE_MARKER: Partial<Record<MarkdownFormat, string>> = { bold: "**", italic: "*" };
const LINE_PREFIX: Partial<Record<MarkdownFormat, string>> = { heading: "## ", list: "- ", quote: "> " };

const clamp = (value: number, max: number) =>
  Math.max(0, Math.min(max, Number.isFinite(value) ? Math.trunc(value) : 0));

/** Applies light Markdown around the selected text or every selected line, toggling it back off. */
export function applyMarkdownFormat({ value, start, end }: TextRange, format: MarkdownFormat): TextRange {
  let from = clamp(start, value.length);
  let to = clamp(end, value.length);
  if (from > to) [from, to] = [to, from];
  const marker = INLINE_MARKER[format];
  if (marker) return toggleInline(value, from, to, marker);
  return toggleLines(value, from, to, LINE_PREFIX[format]!);
}

function toggleInline(value: string, start: number, end: number, marker: string): TextRange {
  const before = value.slice(start - marker.length, start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    return {
      value: value.slice(0, start - marker.length) + value.slice(start, end) + value.slice(end + marker.length),
      start: start - marker.length, end: end - marker.length,
    };
  }
  const selected = value.slice(start, end);
  const wrapsItself = selected.length > marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)
    && (marker !== "*" || (!selected.startsWith("**") && !selected.endsWith("**")));
  if (wrapsItself) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    start: start + marker.length, end: end + marker.length,
  };
}

function toggleLines(value: string, start: number, end: number, prefix: string): TextRange {
  // A selection ending exactly at the next line start must not reformat that next line.
  const last = end > start ? end - 1 : end;
  const blockStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const breakAt = value.indexOf("\n", last);
  const blockEnd = breakAt === -1 ? value.length : breakAt;
  const oldLines = value.slice(blockStart, blockEnd).split("\n");
  const cursorLine = value.slice(blockStart, start).split("\n").length - 1;
  const affected = start === end
    ? [cursorLine]
    : oldLines.map((line, index) => (line.trim() ? index : -1)).filter((index) => index >= 0);
  if (!affected.length) return { value, start, end };

  const remove = affected.every((index) => oldLines[index].startsWith(prefix));
  const newLines = [...oldLines];
  for (const index of affected) {
    if (remove) newLines[index] = newLines[index].slice(prefix.length);
    else if (!newLines[index].startsWith(prefix)) newLines[index] = prefix + newLines[index];
  }
  const newBlock = newLines.join("\n");
  const next = value.slice(0, blockStart) + newBlock + value.slice(blockEnd);
  if (start !== end) return { value: next, start: blockStart, end: blockStart + newBlock.length };

  const offsetOf = (lines: string[], index: number) => lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
  const oldOffset = start - blockStart - offsetOf(oldLines, cursorLine);
  const delta = newLines[cursorLine].length - oldLines[cursorLine].length;
  const cursor = blockStart + offsetOf(newLines, cursorLine) + Math.max(0, Math.min(newLines[cursorLine].length, oldOffset + delta));
  return { value: next, start: cursor, end: cursor };
}
