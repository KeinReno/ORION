import type { AgentProposalDiffEntry } from "@orion/shared-types";

export type DiffKind = "task" | "note" | "event";

const LABELS: Record<DiffKind, Record<string, string>> = {
  task: { title: "Название", description: "Описание", status: "Статус", priority: "Приоритет", dueAt: "Срок" },
  note: { title: "Название", summary: "Краткое содержание", body: "Текст", tags: "Теги" },
  event: {
    title: "Название",
    description: "Описание",
    location: "Место",
    startAt: "Начало",
    endAt: "Конец",
    allDay: "Весь день",
    reminders: "Напоминания (мин)",
    projectId: "Проект"
  }
};

/** Long bodies are cut: the preview shows what changes, the object itself keeps the full text. */
const MAX_VALUE_LENGTH = 600;

/** The fields a patch of this kind may carry — everything else is dropped before it is stored or applied. */
export function patchFields(kind: DiffKind): string[] {
  return Object.keys(LABELS[kind]);
}

function show(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (field === "startAt" || field === "endAt" || field === "dueAt") text = new Date(String(value)).toISOString();
  else if (Array.isArray(value)) text = value.map(String).join(", ");
  else if (typeof value === "boolean") text = value ? "да" : "нет";
  else text = String(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/** Before/after per field the patch actually changes. `current` is the stored object as the service sees it. */
export function buildProposalDiff(kind: DiffKind, current: Record<string, unknown>, patch: Record<string, unknown>): AgentProposalDiffEntry[] {
  const out: AgentProposalDiffEntry[] = [];
  for (const [field, label] of Object.entries(LABELS[kind])) {
    if (!(field in patch) || patch[field] === undefined) continue;
    const before = show(field, current[field]);
    const after = show(field, patch[field]);
    if (before === after) continue;
    out.push({ field, label, before, after });
  }
  return out;
}
