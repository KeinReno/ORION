import { useState, type FormEvent } from "react";
import { Check, ListPlus, Plus, Trash2, Undo2 } from "lucide-react";
import { MAX_DRAFT_CHECKLIST_ITEMS, type DraftChecklistItem } from "@orion/mobile-core";

interface DraftChecklistProps {
  items: DraftChecklistItem[];
  busy: boolean;
  canExtract: boolean;
  change: (items: DraftChecklistItem[]) => void;
  extract: () => void;
}

/** Steps typed before the task exists. Everything here is saved with the draft task. */
export function DraftChecklist({ items, busy, canExtract, change, extract }: DraftChecklistProps) {
  const [title, setTitle] = useState("");
  const [removed, setRemoved] = useState<{ index: number; item: DraftChecklistItem } | null>(null);
  const completed = items.filter((item) => item.done).length;
  const atLimit = items.length >= MAX_DRAFT_CHECKLIST_ITEMS;

  function update(id: string, patch: Partial<DraftChecklistItem>) {
    change(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
  function add(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || busy || atLimit) return;
    change([...items, { id: crypto.randomUUID(), title: clean, done: false }]);
    setTitle(""); setRemoved(null);
  }
  function remove(item: DraftChecklistItem) {
    setRemoved({ index: items.findIndex((entry) => entry.id === item.id), item });
    change(items.filter((entry) => entry.id !== item.id));
  }
  function undo() {
    if (!removed) return;
    const next = [...items];
    next.splice(Math.max(0, Math.min(removed.index, next.length)), 0, removed.item);
    change(next); setRemoved(null);
  }

  return <section className="task-checklist draft-checklist" aria-labelledby="draft-checklist-heading">
    <div className="task-checklist-heading">
      <div><h2 id="draft-checklist-heading">Чек-лист</h2>
        <p>{items.length ? `Выполнено ${completed} из ${items.length}. Сохранится вместе с задачей.` : "Шаги сохранятся вместе с задачей."}</p></div>
      {items.length > 0 && <span aria-hidden="true">{completed}/{items.length}</span>}
    </div>
    <button className="draft-checklist-extract" type="button" disabled={busy || !canExtract} onClick={extract}>
      <ListPlus size={18} />Перенести строки из описания
    </button>
    {!canExtract && <p className="helper">Напишите шаги в описании, чтобы перенести их сюда.</p>}
    {items.length === 0 && <p className="task-checklist-empty">Пока пусто. Добавьте шаг или перенесите строки из описания.</p>}
    {items.length > 0 && <ul className="task-checklist-items draft-checklist-items">
      {items.map((item) => <li key={item.id} className={item.done ? "completed" : undefined}>
        <button className="check-button" type="button" aria-pressed={item.done} disabled={busy}
          aria-label={(item.done ? "Вернуть пункт в работу: " : "Отметить пункт выполненным: ") + (item.title || "без названия")}
          onClick={() => update(item.id, { done: !item.done })}>{item.done && <Check size={18} />}</button>
        <input className={item.done ? "checked" : undefined} aria-label={`Название пункта: ${item.title || "без названия"}`}
          value={item.title} maxLength={200} autoComplete="off" disabled={busy}
          onChange={(event) => update(item.id, { title: event.target.value })} />
        <button className="icon-button" type="button" disabled={busy}
          aria-label={`Удалить пункт из черновика: ${item.title || "без названия"}`} onClick={() => remove(item)}><Trash2 size={18} /></button>
      </li>)}
    </ul>}
    {removed && <div className="draft-checklist-undo" role="status"><span>Пункт удалён из черновика.</span>
      <button type="button" disabled={busy} onClick={undo}><Undo2 size={16} />Вернуть</button></div>}
    {atLimit && <p className="helper">Достигнут предел: {MAX_DRAFT_CHECKLIST_ITEMS} пунктов.</p>}
    <form className="task-checklist-add" onSubmit={add}>
      <label><span>Новый пункт</span><input aria-label="Новый пункт чек-листа" value={title} maxLength={200} required
        disabled={busy || atLimit} placeholder="Например, проверить документы" onChange={(event) => setTitle(event.target.value)} /></label>
      <button type="submit" disabled={busy || atLimit || !title.trim()}><Plus size={18} />Добавить пункт</button>
    </form>
  </section>;
}
