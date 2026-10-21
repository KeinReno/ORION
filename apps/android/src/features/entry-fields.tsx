import type { Draft } from "@orion/mobile-core";
export const STATUS_LABELS = { backlog: "Отложена", todo: "К выполнению", in_progress: "В работе", done: "Завершена", canceled: "Отменена" } as const;
export function localDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}
export function EntryFields({ draft, disabled, change }: { draft: Draft; disabled: boolean; change: (draft: Draft) => void }) {
  return <section className="entry-fields" aria-label="Параметры записи">{draft.kind === "task" ? <>
    <label>Статус<select aria-label="Статус" value={draft.status ?? "todo"} disabled={disabled} onChange={(event) => change({ ...draft, status: event.target.value as NonNullable<Draft["status"]> })}>
      {Object.entries(STATUS_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label>Срок задачи<input type="datetime-local" value={localDateTime(draft.dueAt)} disabled={disabled} onChange={(event) => change({ ...draft, dueAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
    <label>Начало задачи<input type="datetime-local" value={localDateTime(draft.startAt)} disabled={disabled} onChange={(event) => change({ ...draft, startAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
    <label>Плановое время, минуты<input inputMode="numeric" value={draft.estimatedMinutesText ?? ""} maxLength={32} disabled={disabled} placeholder="Не задано" onChange={(event) => change({ ...draft, estimatedMinutesText: event.target.value })} /></label>
    <p className="helper">План не запускает таймер. Очистите поле, чтобы убрать оценку.</p>
    {draft.startAt && <button className="text-button" disabled={disabled} onClick={() => change({ ...draft, startAt: null })}>Убрать начало</button>}
    {draft.startAt && draft.dueAt && draft.startAt > draft.dueAt && <p className="helper">Начало позже срока — проверьте обе даты.</p>}
    <p className="helper">Время указано в часовом поясе телефона. Напоминания в этой версии не отправляются.</p>
    {draft.dueAt && <button className="text-button" disabled={disabled} onClick={() => change({ ...draft, dueAt: null })}>Убрать срок</button>}
  </> : <>
    <label>Краткое описание<input value={draft.summary ?? ""} maxLength={300} disabled={disabled} placeholder="О чём заметка — одной строкой" onChange={(event) => change({ ...draft, summary: event.target.value })} /></label>
    <label>Теги через запятую<input value={draft.tagsText ?? ""} maxLength={2000} disabled={disabled} placeholder="работа, идеи" onChange={(event) => change({ ...draft, tagsText: event.target.value })} /></label>
    <p className="helper">До 20 тегов, каждый до 40 символов.</p>
    <label className="switch-row"><span>Закрепить заметку</span><input type="checkbox" role="switch" checked={Boolean(draft.pinnedAt)} disabled={disabled} onChange={(event) => change({ ...draft, pinnedAt: event.target.checked ? new Date().toISOString() : null })} /></label>
  </>}</section>;
}
