import { useState } from "react";
import { ArrowLeft, Check, Pencil, Plus, Trash2, Archive, RotateCcw, ListChecks } from "lucide-react";
import type { List } from "@orion/shared-types";
import type { MobileListDraft, MobileListMutation } from "@orion/mobile-core";
import { DepthCard } from "../../depth-card";
export interface ListsScreenProps {
  lists: List[]; initialDraft: MobileListDraft | null; busy: boolean; available: boolean; canItems: boolean;
  remote: boolean; selectedId?: string; select: (id?: string) => void;
  saveDraft: (draft: MobileListDraft | null) => Promise<void>;
  mutate: (mutation: MobileListMutation, draft?: MobileListDraft) => Promise<boolean>;
}
export function ListsScreen({ lists, initialDraft, busy, available, canItems, remote, selectedId, select, saveDraft, mutate }: ListsScreenProps) {
  const [draft, setDraft] = useState<MobileListDraft | null>(initialDraft);
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [deleting, setDeleting] = useState<{ list: List; itemId?: string; label: string } | null>(null);
  const selected = lists.find((list) => list.id === selectedId);
  const disabled = busy || savingDraft;
  const deleteNeedsArchive = Boolean(remote && deleting && !deleting.itemId && !lists.find(list => list.id === deleting.list.id)?.archivedAt);
  async function change(next: MobileListDraft) {
    setDraft(next); setError("");
    try { await saveDraft(next); } catch { setError("Черновик не записан на диск. Не закрывайте приложение и повторите сохранение."); }
  }
  function begin(kind: "list" | "item", parentId: string | null, id?: string, text = "") {
    if (draft && draft.id !== id) { setError("Сначала сохраните или отмените открытый черновик списка."); return; }
    void change({ kind, parentId, id: id ?? crypto.randomUUID(), text });
  }
  if (!available) return <section className="empty"><ListChecks size={36} /><h2>Списки недоступны в этой копии</h2><p>Модуль может быть выключен или не входить в доступные данные. Локальные списки телефона сохраняются отдельно.</p></section>;
  const form = draft && <form className="list-draft" onSubmit={async (event) => {
    event.preventDefault(); if (disabled || !draft.text.trim()) return;
    const existing = draft.kind === "list" ? lists.some((list) => list.id === draft.id) : lists.some((list) => list.items.some((item) => item.id === draft.id));
    const mutation: MobileListMutation = { entity: draft.kind === "list" ? "list" : "listItem", kind: existing ? "patch" : "create", id: draft.id,
      ...(draft.parentId ? { parentId: draft.parentId } : {}), fields: draft.kind === "list" ? { name: draft.text } : { label: draft.text } };
    if (await mutate(mutation, draft)) { setDraft(null); setError(""); if (draft.kind === "list") select(draft.id); }
  }}><label>{draft.kind === "list" ? "Название списка" : "Текст пункта"}<input autoComplete="off" value={draft.text} maxLength={draft.kind === "list" ? 120 : 500} disabled={disabled} onChange={(event) => void change({ ...draft, text: event.target.value })} /></label>
    <div className="list-actions"><button className="primary" disabled={disabled || !draft.text.trim()}>Сохранить {draft.kind === "list" ? "список" : "пункт"}</button><button type="button" disabled={disabled} onClick={async () => {
      setSavingDraft(true); try { await saveDraft(null); setDraft(null); setError(""); } catch { setError("Не удалось отменить черновик. Повторите."); } finally { setSavingDraft(false); }
    }}>Отменить ввод</button></div>
  </form>;
  return <section className="lists-page">
    <p className="helper">{remote ? "Копия пространства ПК · изменения отправляются при синхронизации" : "Списки хранятся на этом телефоне"}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {form}
    {selectedId ? <>
      <button className="text-button" onClick={() => select()}><ArrowLeft size={18} />Назад к спискам</button>
      {selected ? <>
        <h2>{selected.name}</h2><p className="helper">Отмечено {selected.items.filter((item) => item.checked).length} из {selected.items.length}</p>
        <div className="list-actions"><button disabled={disabled || selected.isTemplate} onClick={() => begin("list", null, selected.id, selected.name)}><Pencil size={18} />Изменить список</button>
          <button disabled={disabled || selected.isTemplate} onClick={() => void mutate({ entity: "list", kind: "patch", id: selected.id, fields: { archivedAt: selected.archivedAt ? null : new Date().toISOString() } })}>{selected.archivedAt ? <RotateCcw size={18} /> : <Archive size={18} />}{selected.archivedAt ? "Вернуть из архива" : "В архив"}</button>
          <button disabled={disabled || selected.isTemplate || (remote && !selected.archivedAt)} aria-describedby={remote && !selected.archivedAt ? "list-delete-archive-help" : undefined} onClick={() => setDeleting({ list: selected, label: selected.name })}><Trash2 size={18} />Удалить список…</button></div>
        {remote && !selected.archivedAt && <p id="list-delete-archive-help" className="helper">Чтобы удалить список компьютера, сначала нажмите «В архив». Из архива его можно вернуть или удалить окончательно.</p>}
        {!selected.isTemplate && canItems && <button className="primary" disabled={disabled} onClick={() => begin("item", selected.id)}><Plus size={18} />Добавить пункт</button>}
        {selected.isTemplate && <p className="helper">Шаблон можно просмотреть. Создание списка из шаблона пока доступно на компьютере.</p>}
        {!canItems && <p className="helper">Пункты недоступны для изменения в этой копии.</p>}
        <ul className="entries list-items">{selected.items.map((item) => <li key={item.id}><DepthCard><div className="task-row">
          <button className="check-button" disabled={disabled || !canItems || selected.isTemplate} aria-label={(item.checked ? "Снять отметку: " : "Отметить: ") + item.label} aria-pressed={item.checked} onClick={() => void mutate({ entity: "listItem", kind: "patch", id: item.id, parentId: selected.id, fields: { checked: !item.checked } })}>{item.checked && <Check size={18} />}</button>
          <span className={"list-item-label" + (item.checked ? " checked" : "")}>{item.label}{item.quantity !== 1 && <small> × {item.quantity}{item.unit ? " " + item.unit : ""}</small>}</span>
          <button className="icon-button" disabled={disabled || !canItems || selected.isTemplate} aria-label={"Изменить пункт: " + item.label} onClick={() => begin("item", selected.id, item.id, item.label)}><Pencil size={18} /></button>
          <button className="icon-button" disabled={disabled || !canItems || selected.isTemplate} aria-label={"Удалить пункт: " + item.label} onClick={() => setDeleting({ list: selected, itemId: item.id, label: item.label })}><Trash2 size={18} /></button>
        </div></DepthCard></li>)}</ul>
        {!selected.items.length && <p className="helper">Пока нет пунктов. Добавьте первый выше.</p>}
      </> : <section className="empty"><h2>Список недоступен</h2><p>Он мог быть удалён или доступ к нему изменился. Вернитесь к спискам.</p></section>}
    </> : <>
      <button className="primary" disabled={disabled} onClick={() => begin("list", null)}><Plus size={18} />Создать список</button>
      <label className="lists-search">Найти список<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="filters"><button aria-pressed={!archived} onClick={() => setArchived(false)}>Активные списки</button><button aria-pressed={archived} onClick={() => setArchived(true)}>Архив списков</button></div>
      <ul className="entries">{lists.filter((list) => !list.isTemplate && Boolean(list.archivedAt) === archived && list.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((list) => <li key={list.id}>
        <button className="entry-main" onClick={() => select(list.id)}><strong>{list.name}</strong><small>{list.items.filter((item) => item.checked).length} / {list.items.length} отмечено</small></button>
      </li>)}</ul>
      {!lists.some((list) => !list.isTemplate && Boolean(list.archivedAt) === archived && list.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p className="helper">{query ? "Нет списков по этому запросу." : archived ? "Архив списков пуст." : "Создайте первый список — покупки, дела или сборы."}</p>}
    </>}
    {deleting && <section className="list-delete" role="region" aria-label="Подтверждение удаления"><h2>Удалить {deleting.itemId ? "пункт" : "список"} «{deleting.label}»?</h2>
      <p>{deleting.itemId ? "Будет удалён только этот пункт." : `Будет удалён список и ${deleting.list.items.length} пунктов.`} {remote ? "Изменение отправится при синхронизации." : "Отмены удаления в этой версии нет."}</p>
      {deleteNeedsArchive && <p role="alert">Список больше не в архиве. Закройте подтверждение и сначала уберите его в архив.</p>}
      <div className="list-actions"><button className="danger-action" disabled={disabled || deleteNeedsArchive} onClick={async () => {
        if (deleteNeedsArchive) return;
        if (await mutate({ entity: deleting.itemId ? "listItem" : "list", kind: "delete", id: deleting.itemId ?? deleting.list.id, ...(deleting.itemId ? { parentId: deleting.list.id } : {}) })) {
          if (draft && (draft.id === (deleting.itemId ?? deleting.list.id) || (!deleting.itemId && draft.parentId === deleting.list.id))) setDraft(null);
          if (!deleting.itemId) select(); setDeleting(null);
        }
      }}>Удалить {deleting.itemId ? "пункт" : "список"}</button><button disabled={disabled} onClick={() => setDeleting(null)}>Оставить</button></div>
    </section>}
  </section>;
}
