import { useEffect, useState, type FormEvent } from "react";
import { Check, Plus, Save, Trash2 } from "lucide-react";
import { isTaskClosed, type Task } from "@orion/shared-types";

interface TaskChecklistProps {
  parentId: string | null;
  items: Task[];
  busy: boolean;
  remote: boolean;
  nested: ReadonlyMap<string, number>;
  add: (title: string) => Promise<boolean>;
  rename: (item: Task, title: string) => Promise<boolean>;
  toggle: (item: Task) => Promise<boolean>;
  remove: (item: Task) => Promise<boolean>;
}

export function TaskChecklist({ parentId, items, busy, remote, nested, add, rename, toggle, remove }: TaskChecklistProps) {
  const [title, setTitle] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const deleting = ordered.find((item) => item.id === deletingId);
  const completed = ordered.filter((item) => isTaskClosed(item.status)).length;

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    setNames((current) => {
      const kept = Object.entries(current).filter(([id]) => ids.has(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [items]);

  async function submitNew(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || busy) return;
    if (await add(next)) setTitle("");
  }

  async function submitRename(event: FormEvent, item: Task) {
    event.preventDefault();
    const next = (names[item.id] ?? item.title).trim();
    if (!next || next === item.title || busy) return;
    if (await rename(item, next)) setNames((current) => {
      const copy = { ...current };
      delete copy[item.id];
      return copy;
    });
  }

  return <section className="task-checklist" aria-labelledby="task-checklist-heading">
    <div className="task-checklist-heading">
      <div><h2 id="task-checklist-heading">Чек-лист</h2><p>{ordered.length ? `Выполнено ${completed} из ${ordered.length}` : "Добавьте шаги, которые можно отмечать отдельно."}</p></div>
      {ordered.length > 0 && <span aria-hidden="true">{completed}/{ordered.length}</span>}
    </div>
    {!parentId ? <p className="helper">Сначала сохраните задачу. После этого здесь можно будет добавить пункты чек-листа.</p> : <>
      {ordered.length === 0 && <p className="task-checklist-empty">Пунктов пока нет.</p>}
      {ordered.length > 0 && <ul className="task-checklist-items">
        {ordered.map((item) => {
          const closed = isTaskClosed(item.status);
          const value = names[item.id] ?? item.title;
          const changed = value.trim() !== item.title;
          return <li key={item.id}>
            <button className="check-button" type="button" aria-label={(closed ? "Вернуть пункт в работу: " : "Отметить пункт выполненным: ") + item.title}
              aria-pressed={closed} disabled={busy} onClick={() => void toggle(item)}>{closed && <Check size={18} />}</button>
            <form className="task-checklist-name" onSubmit={(event) => void submitRename(event, item)}>
              <input aria-label={`Название пункта: ${item.title}`} className={closed ? "checked" : ""} value={value} maxLength={200} required disabled={busy}
                onChange={(event) => setNames((current) => ({ ...current, [item.id]: event.target.value }))} />
              {changed && <button className="icon-button" type="submit" aria-label={`Сохранить название пункта: ${item.title}`} disabled={busy || !value.trim()}><Save size={18} /></button>}
            </form>
            <button className="icon-button" type="button" aria-label={`Удалить пункт чек-листа: ${item.title}`} aria-expanded={deletingId === item.id} disabled={busy}
              onClick={() => setDeletingId(item.id)}><Trash2 size={18} /></button>
          </li>;
        })}
      </ul>}
      {deleting && <section className="task-checklist-delete" role="region" aria-label="Подтверждение удаления">
        <h3>Удалить пункт «{deleting.title}»?</h3>
        <p>{nested.get(deleting.id) ? `Вместе с ним удалятся вложенные пункты: ${nested.get(deleting.id)}.` : "Будет удалён только этот пункт."} {remote ? "Изменение отправится при синхронизации." : "Отмены удаления в этой версии нет."}</p>
        <div className="list-actions"><button className="danger-action" type="button" disabled={busy} onClick={async () => { if (await remove(deleting)) setDeletingId(null); }}><Trash2 size={18} />Удалить пункт</button>
          <button type="button" disabled={busy} onClick={() => setDeletingId(null)}>Оставить</button></div>
      </section>}
      <form className="task-checklist-add" onSubmit={(event) => void submitNew(event)}>
        <label><span>Новый пункт</span><input aria-label="Новый пункт чек-листа" value={title} maxLength={200} required disabled={busy}
          placeholder="Например, проверить документы" onChange={(event) => setTitle(event.target.value)} /></label>
        <button type="submit" disabled={busy || !title.trim()}><Plus size={18} />Добавить пункт</button>
      </form>
    </>}
  </section>;
}
