/**
 * Markdown formatting as pure text transforms: (document, selection, command)
 * → one replacement + the selection to restore. No CodeMirror, no DOM — so the
 * rules (toggle on/off, multi-line lists, numbering) are unit-tested, and the
 * editor only has to apply the result as a single undoable transaction.
 *
 * The note body stays plain Markdown the whole time: these commands only type
 * the same characters a person would.
 */

export type FormatCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "codeblock";

export interface FormatSelection {
  from: number;
  to: number;
}

export interface FormatResult {
  /** Replace `doc.slice(from, to)` with `insert`… */
  from: number;
  to: number;
  insert: string;
  /** …then select this range (offsets in the NEW document). */
  anchor: number;
  head: number;
}

const INLINE_MARK: Partial<Record<FormatCommand, string>> = {
  bold: "**",
  italic: "_",
  strike: "~~",
  code: "`"
};

const LINE_PREFIX_RE = /^(\s*)(?:#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/;

export function applyFormat(doc: string, selection: FormatSelection, command: FormatCommand): FormatResult {
  const from = Math.max(0, Math.min(selection.from, selection.to));
  const to = Math.min(doc.length, Math.max(selection.from, selection.to));
  const mark = INLINE_MARK[command];
  if (mark) return toggleInline(doc, from, to, mark);
  if (command === "link") return link(doc, from, to);
  if (command === "codeblock") return codeBlock(doc, from, to);
  return lineCommand(doc, from, to, command);
}

function toggleInline(doc: string, from: number, to: number, mark: string): FormatResult {
  const selected = doc.slice(from, to);
  const len = mark.length;

  // "**|text|**" — the markers sit just outside the selection: remove them.
  if (from >= len && doc.slice(from - len, from) === mark && doc.slice(to, to + len) === mark) {
    return { from: from - len, to: to + len, insert: selected, anchor: from - len, head: from - len + selected.length };
  }
  // "|**text**|" — the selection includes the markers: remove them.
  if (selected.length >= len * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(len, selected.length - len);
    return { from, to, insert: inner, anchor: from, head: from + inner.length };
  }
  // Nothing selected: leave the caret between a fresh pair of markers.
  if (from === to) {
    return { from, to, insert: mark + mark, anchor: from + len, head: from + len };
  }
  return { from, to, insert: mark + selected + mark, anchor: from + len, head: from + len + selected.length };
}

function link(doc: string, from: number, to: number): FormatResult {
  const selected = doc.slice(from, to);
  const url = "https://";
  if (selected.length === 0) {
    const text = "текст";
    return { from, to, insert: `[${text}](${url})`, anchor: from + 1, head: from + 1 + text.length };
  }
  // Selected text becomes the label; the URL placeholder is selected so it can be typed over.
  const urlStart = from + 1 + selected.length + 2;
  return { from, to, insert: `[${selected}](${url})`, anchor: urlStart, head: urlStart + url.length };
}

/** Expand to whole lines: [start of the first line, end of the last line). */
function lineBounds(doc: string, from: number, to: number): { start: number; end: number } {
  const start = doc.lastIndexOf("\n", from - 1) + 1;
  // A selection that ends right after a newline does not include the next line.
  const probe = to > from && doc[to - 1] === "\n" ? to - 1 : to;
  const nl = doc.indexOf("\n", probe);
  return { start, end: nl === -1 ? doc.length : nl };
}

function stripPrefix(line: string): { indent: string; body: string } {
  const match = LINE_PREFIX_RE.exec(line);
  if (!match) {
    const indent = /^\s*/.exec(line)?.[0] ?? "";
    return { indent, body: line.slice(indent.length) };
  }
  return { indent: match[1] ?? "", body: line.slice(match[0].length) };
}

function lineCommand(doc: string, from: number, to: number, command: FormatCommand): FormatResult {
  const { start, end } = lineBounds(doc, from, to);
  const lines = doc.slice(start, end).split("\n");
  const content = lines.filter((line) => line.trim() !== "");

  const headingLevel = command === "h1" ? 1 : command === "h2" ? 2 : command === "h3" ? 3 : 0;
  const prefixOf = (index: number): string => {
    if (headingLevel) return `${"#".repeat(headingLevel)} `;
    if (command === "bullet") return "- ";
    if (command === "task") return "- [ ] ";
    if (command === "quote") return "> ";
    return `${index + 1}. `; // ordered
  };

  // Toggle off when every non-empty line already carries exactly this prefix.
  const already = (line: string): boolean => {
    if (headingLevel) return new RegExp(`^\\s*#{${headingLevel}}\\s+`).test(line) && !/^\s*#{${headingLevel + 1}}/.test(line);
    if (command === "bullet") return /^\s*[-*+]\s+(?!\[[ xX]\])/.test(line);
    if (command === "task") return /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line);
    if (command === "quote") return /^\s*>\s?/.test(line);
    return /^\s*\d+[.)]\s+/.test(line);
  };
  const remove = content.length > 0 && content.every(already);

  let counter = 0;
  const out = lines.map((line) => {
    if (line.trim() === "") return line;
    const { indent, body } = stripPrefix(line);
    if (remove) return indent + body;
    const text = indent + prefixOf(counter) + body;
    counter += 1;
    return text;
  });

  const insert = out.join("\n");
  return { from: start, to: end, insert, anchor: start, head: start + insert.length };
}

function codeBlock(doc: string, from: number, to: number): FormatResult {
  const { start, end } = lineBounds(doc, from, to);
  const block = doc.slice(start, end);
  const lines = block.split("\n");
  // Already fenced as a whole: unwrap.
  if (lines.length >= 2 && /^```/.test(lines[0] ?? "") && (lines[lines.length - 1] ?? "").trim() === "```") {
    const inner = lines.slice(1, -1).join("\n");
    return { from: start, to: end, insert: inner, anchor: start, head: start + inner.length };
  }
  const insert = "```\n" + block + "\n```";
  // Empty line: put the caret inside the fence so typing starts there.
  if (block.trim() === "") return { from: start, to: end, insert, anchor: start + 4, head: start + 4 };
  return { from: start, to: end, insert, anchor: start + 4, head: start + 4 + block.length };
}
