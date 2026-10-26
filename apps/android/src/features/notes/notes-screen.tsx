import { orderNotes, type NoteSort } from "../view-order";
import { ModuleFilters } from "../module-filters";
import { noteExcerpt } from "./note-excerpt";
import type { ReactNode } from "react";
import { Archive, RotateCcw, NotebookPen, Search, Pin } from "lucide-react";
import type { Note } from "@orion/shared-types";
import { DepthCard } from "../../depth-card";
export interface NotesScreenProps {
  sort: NoteSort; setSort: (value: NoteSort) => void;
  tag: string; setTag: (value: string) => void; pinned: boolean; setPinned: (value: boolean) => void;
  notes: Note[]; busy: boolean; query: string; setQuery: (value: string) => void;
  archive: boolean; setArchive: (value: boolean) => void; remote: boolean; available: boolean;
  edit: (note: Note) => void; archiveNote: (note: Note) => void;
  menu: (note: Note) => ReactNode; actions: (note: Note) => ReactNode;
}
export function NotesScreen({ sort, setSort, tag, setTag, pinned, setPinned, notes: allNotes, busy, query, setQuery, archive, setArchive, remote, available, edit, archiveNote, menu, actions }: NotesScreenProps) {
  const tags = [...new Set(allNotes.flatMap((note) => note.tags))].sort((a,b) => a.localeCompare(b));
  const notes = orderNotes(allNotes.filter((note) => (!tag || note.tags.includes(tag)) && (!pinned || Boolean(note.pinnedAt))), sort);
  const filtered = Boolean(tag || pinned);
  return <>
    <DepthCard><label className="search"><Search size={20} /><span className="sr-only">Поиск</span><input type="search" placeholder="Найти заметку" value={query} onChange={(event) => setQuery(event.target.value)} /></label></DepthCard>
    <div className="filters view-presets"><button aria-pressed={!archive} onClick={() => setArchive(false)}>Все заметки</button><button aria-pressed={archive} onClick={() => setArchive(true)}><Archive size={16} />Архив</button></div>
    <DepthCard><ModuleFilters name="Фильтры заметок" active={Number(Boolean(tag)) + Number(pinned) + Number(sort !== "updated")}>
      <label>Порядок заметок<select aria-label="Порядок заметок" value={sort} onChange={(e) => setSort(e.target.value as NoteSort)}><option value="updated">По изменению текста</option><option value="created">Сначала новые</option><option value="title">По названию</option></select></label>
      <label>Тег заметок<select aria-label="Тег заметок" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">Все теги</option>{tag && !tags.includes(tag) && <option value={tag}>{tag}</option>}{tags.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="switch-row"><span>Только закреплённые</span><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /></label>
    </ModuleFilters></DepthCard>
    <div className="results-line"><p role="status">Показано: {notes.length} · закреплённые первыми</p>{filtered && <button className="text-button" onClick={() => { setTag(""); setPinned(false); }}>Сбросить фильтры заметок</button>}</div>
    {available && <ul className="entries notes">{notes.map((note) => <li key={note.id}><DepthCard><div className="note-depth-row"><button className="entry-main" onClick={() => edit(note)}><strong>{note.pinnedAt && <Pin size={14} aria-label="Закреплена" />} {note.title}</strong><span className="excerpt">{note.summary || noteExcerpt(note.body) || "Пока только название"}</span>{note.tags.length > 0 && <span className="note-tags">{note.tags.map((value) => "#" + value).join(" · ")}</span>}<small>{new Date(note.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</small></button>
      <button className="icon-button" aria-label={(archive ? "Вернуть из архива: " : "В архив: ") + note.title} disabled={busy} onClick={() => archiveNote(note)}>{archive ? <RotateCcw size={20} /> : <Archive size={20} />}</button>{menu(note)}
      </div>{actions(note)}</DepthCard></li>)}</ul>}
    {(!notes.length || !available) && <DepthCard><section className="empty"><NotebookPen size={36} /><h2>{!available ? "Модуль недоступен" : query || filtered ? "Ничего не найдено" : archive ? "Архив пока пуст" : "Место для вашей мысли"}</h2>
      <p>{!available ? "Этот модуль недоступен в пространстве компьютера." : query || filtered ? "Измените фильтры или очистите поиск." : archive ? "Здесь будут заметки, которые вы отложили." : remote ? "Создайте запись в локальной копии, затем синхронизируйте её с ПК." : "Нажмите «Создать». Всё сохранится на телефоне, даже в авиарежиме."}</p>
      {query && <button onClick={() => setQuery("")}>Очистить поиск</button>}</section></DepthCard>}
  </>;
}
