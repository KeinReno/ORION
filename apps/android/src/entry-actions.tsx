import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";

export function EntryActions({ kind, title, remote, busy, edit, remove, close, defaultConfirm = false }: {
  kind: "task" | "note"; title: string; remote: boolean; busy: boolean;
  edit: () => void; remove: () => Promise<boolean>; close: () => void; defaultConfirm?: boolean;
}) {
  const [confirm, setConfirm] = useState(defaultConfirm);
  const name = kind === "task" ? "задачу" : "заметку";
  return <section className="entry-action-panel" aria-label={"Действия: " + title}>
    {confirm ? <>
      <p>Удалить {name} «{title}»?</p>
      <p className="helper">{remote ? "Удаление сохранится в копии и отправится в это пространство ПК при синхронизации." : "Запись будет удалена с этого телефона. Отмены удаления в этой версии нет."}</p>
      <button className="danger-action" disabled={busy} onClick={async () => { if (await remove()) close(); }}><Trash2 size={18} />Удалить {name}</button>
      <button disabled={busy} onClick={() => setConfirm(false)}>Оставить запись</button>
    </> : <>
      <button disabled={busy} onClick={edit}><Pencil size={18} />Изменить {name}</button>
      <button disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={18} />Удалить {name}…</button>
      <button className="icon-button" disabled={busy} onClick={close} aria-label="Закрыть действия"><X size={18} /></button>
    </>}
  </section>;
}
