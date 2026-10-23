export interface ChecklistSeed { title: string; done: boolean }
export interface ExtractedChecklist { items: ChecklistSeed[]; body: string }

export const MAX_CHECKLIST_ITEM_LENGTH = 200;
export const MAX_CHECKLIST_ITEMS = 200;

const LIST_LINE = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const CHECKBOX = /^\[([ xX])\]\s*(.*)$/;

/**
 * Moves explicit list/checkbox lines, or every non-empty line, into checklist steps.
 * Only consumed lines leave the description; surrounding prose stays untouched.
 */
export function extractChecklist(source: string, existingCount = 0): ExtractedChecklist {
  const lines = source.split(/\r?\n/);
  // Fenced examples are content, never checklist instructions.
  const fenced = new Set<number>(); let fence: string | null = null;
  lines.forEach((line, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) { fenced.add(index); if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null; }
    else if (marker) { fence = marker; fenced.add(index); }
  });
  const explicit = lines.some((line, index) => !fenced.has(index) && (LIST_LINE.test(line) || CHECKBOX.test(line.trim())));
  const used = new Set<number>();
  const items: ChecklistSeed[] = [];
  lines.forEach((line, index) => {
    if (fenced.has(index)) return;
    const list = LIST_LINE.exec(line);
    if (explicit && !list && !CHECKBOX.test(line.trim())) return;
    if (!explicit && !line.trim()) return;
    const content = (list ? list[1] : line).trim();
    const checked = CHECKBOX.exec(content);
    const title = (checked ? checked[2] : content).trim();
    used.add(index);
    if (!title) return;
    if (title.length > MAX_CHECKLIST_ITEM_LENGTH) {
      throw new Error(`Строка ${index + 1} длиннее ${MAX_CHECKLIST_ITEM_LENGTH} символов. Сократите её и повторите.`);
    }
    items.push({ title, done: Boolean(checked && checked[1].toLowerCase() === "x") });
  });
  if (!items.length) throw new Error("Не нашли шагов. Напишите каждый шаг с новой строки или начните строку с «-».");
  if (existingCount + items.length > MAX_CHECKLIST_ITEMS) {
    throw new Error(`В чек-листе не больше ${MAX_CHECKLIST_ITEMS} пунктов. Сократите список.`);
  }
  const body = lines.filter((_, index) => !used.has(index)).join("\n").trim();
  return { items, body };
}
