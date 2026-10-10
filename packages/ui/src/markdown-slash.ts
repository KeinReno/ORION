/**
 * The «/» menu of the note editor: type `/` at the start of a line (or after a space) and pick a
 * block to insert. Kept free of CodeMirror so what each command inserts, and what a typed word
 * matches, is plain data under test.
 */

export interface SlashCommand {
  id: string;
  /** Shown in the menu. */
  label: string;
  /** One-line hint beside the label. */
  detail: string;
  /** Extra words a person might type (Latin and Russian). */
  aliases: string[];
  /** Text to put in place of the typed `/word`. */
  insert: string;
  /** Where the caret ends, as an offset into `insert` (default: after it). */
  caret?: number;
  /** Selection length from `caret` (e.g. the placeholder word of a link). */
  select?: number;
  /** Block commands only make sense at the start of a line. */
  block: boolean;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: "h1", label: "Заголовок 1", detail: "# Крупный заголовок", aliases: ["h1", "заголовок", "title", "heading"], insert: "# ", block: true },
  { id: "h2", label: "Заголовок 2", detail: "## Раздел", aliases: ["h2", "заголовок", "heading"], insert: "## ", block: true },
  { id: "h3", label: "Заголовок 3", detail: "### Подраздел", aliases: ["h3", "заголовок", "heading"], insert: "### ", block: true },
  { id: "ul", label: "Список", detail: "- маркированный", aliases: ["ul", "list", "список", "маркер", "bullet"], insert: "- ", block: true },
  { id: "ol", label: "Нумерованный список", detail: "1. по порядку", aliases: ["ol", "number", "нумерация", "список"], insert: "1. ", block: true },
  { id: "todo", label: "Чек-лист", detail: "- [ ] пункт", aliases: ["todo", "task", "check", "чеклист", "задача", "галочка"], insert: "- [ ] ", block: true },
  { id: "quote", label: "Цитата", detail: "> выделенный абзац", aliases: ["quote", "цитата", "blockquote"], insert: "> ", block: true },
  { id: "code", label: "Блок кода", detail: "``` код ```", aliases: ["code", "код", "pre"], insert: "```\n\n```", caret: 4, block: true },
  { id: "hr", label: "Разделитель", detail: "---", aliases: ["hr", "divider", "line", "линия", "разделитель"], insert: "---\n", block: true },
  {
    id: "table",
    label: "Таблица",
    detail: "2 колонки",
    aliases: ["table", "таблица"],
    insert: "| Колонка | Колонка |\n| --- | --- |\n|  |  |\n",
    caret: 38,
    block: true
  },
  { id: "link", label: "Ссылка", detail: "[текст](адрес)", aliases: ["link", "url", "ссылка"], insert: "[текст](https://)", caret: 1, select: 5, block: false },
  { id: "wiki", label: "Ссылка на заметку", detail: "[[Название]]", aliases: ["wiki", "note", "заметка", "связь"], insert: "[[]]", caret: 2, block: false }
];

/** Commands matching what was typed after the `/`, in menu order. `atLineStart` hides block commands mid-line. */
export function filterSlashCommands(typed: string, atLineStart: boolean): SlashCommand[] {
  const needle = typed.trim().toLowerCase();
  return SLASH_COMMANDS.filter((command) => {
    if (command.block && !atLineStart) return false;
    if (needle === "") return true;
    return command.label.toLowerCase().includes(needle) || command.aliases.some((alias) => alias.startsWith(needle));
  });
}

/** Is the `/` a menu trigger? Only at the start of a line or after whitespace — not inside `http://x` or `a/b`. */
export function isSlashTrigger(charBeforeSlash: string | undefined): boolean {
  return charBeforeSlash === undefined || charBeforeSlash === "" || /\s/.test(charBeforeSlash);
}
