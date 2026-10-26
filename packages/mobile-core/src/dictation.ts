import type { Draft } from "./mobile-models";

export function appendDictation(draft: Draft, text: string, field: "title" | "body", id: string): Draft {
  if (draft.lastDictationId === id) return draft;
  const recognized = text.trim();
  if (!recognized) throw new Error("Речь не распознана. Повторите диктовку.");
  const previous = draft[field];
  const value = previous ? previous + (field === "title" ? " " : "\n") + recognized : recognized;
  if (value.length > (field === "title" ? 200 : 20000)) throw new Error(field === "title"
    ? "Название получится длиннее 200 символов. Добавьте диктовку в текст записи."
    : "Текст получится длиннее 20 000 символов. Скопируйте диктовку в отдельную запись.");
  return { ...draft, [field]: value, lastDictationId: id };
}
