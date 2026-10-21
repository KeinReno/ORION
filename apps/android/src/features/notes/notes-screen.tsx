import type { ReactNode } from "react";
import { Archive, RotateCcw, NotebookPen, Search } from "lucide-react";
import type { Note } from "@orion/shared-types";
import { DepthCard } from "../../depth-card";
export interface NotesScreenProps {
  notes: Note[]; busy: boolean; query: string; setQuery: (value: string) => void;
  archive: boolean; setArchive: (value: boolean) => void; remote: boolean; available: boolean;
  edit: (note: Note) => void; archiveNote: (note: Note) => void;
  menu: (note: Note) => ReactNode; actions: (note: Note) => ReactNode;
}
export function NotesScreen({ notes, busy, query, setQuery, archive, setArchive, remote, available, edit, archiveNote, menu, actions }: NotesScreenProps) {
  return <>
    <DepthCard><label className="search"><Search size={20} /><span className="sr-only">Поиск</span><input type="search" placeholder="Найти заметку" value={query} onChange={(event) => setQuery(event.target.value)} /></label></DepthCard>
    <div className="filters"><button aria-pressed={!archive} onClick={() => setArchive(false)}>Все заметки</button><button aria-pressed={archive} onClick={() => setArchive(true)}><Archive size={16} />Архив</button></div>
    {available && <ul className="entries notes">{notes.map((note) => <li key={note.id}><DepthCard><div className="note-depth-row"><button className="entry-main" onClick={() => edit(note)}><strong>{note.title}</strong><span className="excerpt">{note.body || "Пока только название"}</span><small>{new Date(note.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</small></button>
      <button className="icon-button" aria-label={(archive ? "Вернуть из архива: " : "В архив: ") + note.title} disabled={busy} onClick={() => archiveNote(note)}>{archive ? <RotateCcw size={20} /> : <Archive size={20} />}</button>{menu(note)}
      </div>{actions(note)}</DepthCard></li>)}</ul>}
    {(!notes.length || !available) && <DepthCard><section className="empty"><NotebookPen size={36} /><h2>{!available ? "Модуль недоступен" : query ? "Ничего не найдено" : archive ? "Архив пока пуст" : "Место для вашей мысли"}</h2>
      <p>{!available ? "Этот модуль недоступен в пространстве компьютера." : query ? "Попробуйте другое слово или очистите поиск." : archive ? "Здесь будут заметки, которые вы отложили." : remote ? "Создайте запись в локальной копии, затем синхронизируйте её с ПК." : "Нажмите «Создать». Всё сохранится на телефоне, даже в авиарежиме."}</p>
      {query && <button onClick={() => setQuery("")}>Очистить поиск</button>}</section></DepthCard>}
  </>;
}
