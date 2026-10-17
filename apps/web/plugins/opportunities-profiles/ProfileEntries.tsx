"use client";
import { useCore } from "@orion/core-react";
import type { OpportunityFact, OpportunityTrack } from "@orion/shared-types";
import { Button, Input } from "@orion/ui";
import { useEffect, useState } from "react";

const fieldClass = "block w-full min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm";
const STATE_LABEL = { confirmed: "Подтверждён владельцем", disputed: "Оспорен", unverified: "Не проверен" } as const;

interface EntriesProps {
  ws: string; profileId: string; canManage: boolean; archivedProfile: boolean;
  facts: OpportunityFact[]; tracks: OpportunityTrack[]; busy: boolean;
  /** Выполняет запись с общим busy/ошибкой/обновлением профиля; возвращает true при успехе. */
  run: (task: () => Promise<unknown>) => Promise<boolean>;
  /** Сообщает владельцу формы о несохранённой inline-правке: она блокирует выбор резюме и уход со страницы. */
  onEditing: (editing: boolean) => void;
}

export function FactsSection({ ws, profileId, canManage, archivedProfile, facts, busy, run, onEditing }: EntriesProps) {
  const { api } = useCore();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [source, setSource] = useState("");
  const editable = canManage && !archivedProfile;
  useEffect(() => { onEditing(editing !== null); return () => onEditing(false); }, [editing, onEditing]);
  const shown = facts.filter((f) => showArchived || !f.archivedAt);
  const archivedCount = facts.filter((f) => f.archivedAt).length;

  function startEdit(fact: OpportunityFact) { setEditing(fact.id); setStatement(fact.statement); setSource(fact.source); }
  async function save(fact: OpportunityFact) {
    const patch = { expectedRevision: fact.revision, ...(statement.trim() !== fact.statement ? { statement: statement.trim() } : {}), ...(source.trim() !== fact.source ? { source: source.trim() } : {}) };
    if (Object.keys(patch).length === 1) { setEditing(null); return; }
    if (await run(() => api.updateOpportunityFact(ws, profileId, fact.id, patch))) setEditing(null);
  }

  return <section className="space-y-2" aria-label="Факты">
    <h3 className="font-medium">Факты ({facts.filter((f) => !f.archivedAt).length})</h3>
    {!facts.length && <p className="text-sm text-muted-foreground">Фактов пока нет. Текст резюме не подтверждает их автоматически.</p>}
    {archivedCount > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Показать архивные ({archivedCount})</label>}
    {shown.map((f) => <div key={f.id} className="rounded-lg border border-border p-3 text-sm">
      {editing === f.id ? <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(f); }}>
        <label className="block">Формулировка<textarea required maxLength={2000} className={`${fieldClass} min-h-24`} value={statement} onChange={(e) => setStatement(e.target.value)} /></label>
        <label className="block">Источник<Input required maxLength={1000} value={source} onChange={(e) => setSource(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground">После изменения факт снова станет «Не проверен»: подтверждение относилось к прежней формулировке.</p>
        <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy}>Сохранить факт</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Отмена</Button></div>
      </form> : <>
        <p className={f.archivedAt ? "text-muted-foreground line-through" : ""}>{f.statement}</p>
        <p className="text-muted-foreground">Источник: {f.source} · {STATE_LABEL[f.state]}{f.archivedAt ? " · В архиве" : ""}</p>
        {editable && <div className="mt-2 flex flex-wrap gap-2">
          {!f.archivedAt && (["confirmed", "disputed", "unverified"] as const).filter((s) => s !== f.state).map((s) =>
            <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.setOpportunityFactState(ws, profileId, f.id, { expectedRevision: f.revision, state: s }))}>{s === "confirmed" ? "Подтвердить факт" : s === "disputed" ? "Оспорить" : "Снять подтверждение"}</Button>)}
          {!f.archivedAt && <Button size="sm" variant="outline" disabled={busy || editing !== null} onClick={() => startEdit(f)}>Изменить</Button>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.archiveOpportunityFact(ws, profileId, f.id, { expectedRevision: f.revision, archived: !f.archivedAt }))}>{f.archivedAt ? "Вернуть из архива" : "В архив"}</Button>
        </div>}
      </>}
    </div>)}
  </section>;
}

export function TracksSection({ ws, profileId, canManage, archivedProfile, facts, tracks, busy, run, onEditing }: EntriesProps) {
  const { api } = useCore();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [factIds, setFactIds] = useState<string[]>([]);
  const editable = canManage && !archivedProfile;
  useEffect(() => { onEditing(editing !== null); return () => onEditing(false); }, [editing, onEditing]);
  const factById = new Map(facts.map((f) => [f.id, f]));
  const shown = tracks.filter((t) => showArchived || !t.archivedAt);
  const archivedCount = tracks.filter((t) => t.archivedAt).length;

  function startEdit(track: OpportunityTrack) { setEditing(track.id); setName(track.name); setFactIds(track.factIds); }
  async function save(track: OpportunityTrack) {
    const sameFacts = factIds.length === track.factIds.length && factIds.every((id) => track.factIds.includes(id));
    const patch = { expectedRevision: track.revision, ...(name.trim() !== track.name ? { name: name.trim() } : {}), ...(sameFacts ? {} : { factIds }) };
    if (Object.keys(patch).length === 1) { setEditing(null); return; }
    if (await run(() => api.updateOpportunityTrack(ws, profileId, track.id, patch))) setEditing(null);
  }

  return <section className="space-y-2" aria-label="Треки">
    <h3 className="font-medium">Треки ({tracks.filter((t) => !t.archivedAt).length})</h3>
    {archivedCount > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Показать архивные ({archivedCount})</label>}
    {shown.map((t) => <div key={t.id} className="rounded-lg border border-border p-3 text-sm">
      {editing === t.id ? <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(t); }}>
        <label className="block">Название трека<Input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <fieldset className="space-y-1"><legend>Факты трека</legend>
          {facts.filter((f) => !f.archivedAt || factIds.includes(f.id)).map((f) => <label key={f.id} className="flex gap-2"><input type="checkbox" checked={factIds.includes(f.id)} onChange={(e) => setFactIds((ids) => e.target.checked ? [...ids, f.id] : ids.filter((v) => v !== f.id))} /><span>{f.statement} <span className="text-muted-foreground">({STATE_LABEL[f.state]}{f.archivedAt ? ", в архиве" : ""})</span></span></label>)}
        </fieldset>
        <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy}>Сохранить трек</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Отмена</Button></div>
      </form> : <>
        <p className={t.archivedAt ? "text-muted-foreground line-through" : "font-medium"}>{t.name}{t.archivedAt ? " · В архиве" : ""}</p>
        <p className="text-muted-foreground">Фактов: {t.factIds.length}{t.factIds.length ? `, из них подтверждено владельцем: ${t.factIds.filter((id) => factById.get(id)?.state === "confirmed" && !factById.get(id)?.archivedAt).length}` : ""}</p>
        {editable && <div className="mt-2 flex flex-wrap gap-2">
          {!t.archivedAt && <Button size="sm" variant="outline" disabled={busy || editing !== null} onClick={() => startEdit(t)}>Изменить трек</Button>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.archiveOpportunityTrack(ws, profileId, t.id, { expectedRevision: t.revision, archived: !t.archivedAt }))}>{t.archivedAt ? "Вернуть трек" : "Трек в архив"}</Button>
        </div>}
      </>}
    </div>)}
  </section>;
}
