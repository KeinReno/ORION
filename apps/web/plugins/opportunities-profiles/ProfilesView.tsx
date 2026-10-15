"use client";
import { useCore } from "@orion/core-react";
import { createOpportunityProfileInputSchema, createOpportunityMaterialInputSchema, createOpportunityFactInputSchema, createOpportunityTrackInputSchema, updateOpportunityProfileInputSchema, type OpportunityProfileDetail } from "@orion/shared-types";
import { Button, ConfirmDialog, Input, Skeleton } from "@orion/ui";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { OpportunitiesViewSlotProps } from "../../lib/extensions/contracts";
import { describeError, useUnsavedDraft } from "../../lib/extensions/host-api";
const fieldClass = "block w-full min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm";
export function ProfilesView({ workspaceId: ws, workspaceLabel, canManage, onDirtyChange }: OpportunitiesViewSlotProps) {
  const { api } = useCore(); const cache = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null); const [archive, setArchive] = useState(false);
  const [name, setName] = useState(""); const [kind, setKind] = useState<"person" | "team">("person"); const [ack, setAck] = useState(false);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [pending, setPending] = useState<{ id: string | null } | null>(null);
  useUnsavedDraft(dirty); useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const list = useInfiniteQuery({ queryKey: ["opportunity-profiles", ws, archive], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => api.listOpportunityProfiles(ws, pageParam, archive), getNextPageParam: (p) => p.nextCursor ?? undefined });
  async function create() {
    setBusy(true); setError("");
    try { const row = await api.createOpportunityProfile(ws, createOpportunityProfileInputSchema.parse({ displayName: name, kind, acknowledgeWorkspaceVisibility: ack })); setName(""); setAck(false); setDirty(false); setSelected(row.id); await cache.invalidateQueries({ queryKey: ["opportunity-profiles", ws] }); }
    catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  function choose(id: string | null, discard = false) { if (busy || id === selected) return; if (dirty && !discard) { setPending({ id }); return; } setPending(null); setDirty(false); setName(""); setAck(false); setSelected(id); }
  return <div className="space-y-4">
    <ConfirmDialog open={pending !== null} title="Сменить профиль без сохранения?" description="Несохранённый ввод будет потерян." confirmLabel="Сменить профиль" danger={false} onCancel={() => setPending(null)} onConfirm={() => { if (pending) choose(pending.id, true); }} />
    <p className="text-sm text-muted-foreground">Профили и материалы видны участникам пространства «{workspaceLabel}». Изменять их может владелец. Для личных данных используйте отдельное личное пространство.</p>
    <div className="flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} />Показать архив</label>{canManage && <Button variant="outline" disabled={busy} onClick={() => choose(null)}>Новый профиль</Button>}</div>
    {list.isLoading ? <Skeleton className="h-20" /> : list.isError ? <p role="alert">{describeError(list.error)}</p> : <ul className="flex flex-wrap gap-2">{list.data?.pages.flatMap((p) => p.items).map((p) => <li key={p.id}><Button variant={selected === p.id ? "primary" : "outline"} disabled={busy} onClick={() => choose(p.id)}>{p.displayName}{p.archivedAt ? " · Архив" : ""}</Button></li>)}</ul>}
    {list.hasNextPage && <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Загрузить ещё профили</Button>}
    {selected ? <ProfileDetail key={selected} id={selected} ws={ws} canManage={canManage} onDirty={setDirty} onBusy={setBusy} /> : canManage && <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={(e) => { e.preventDefault(); void create(); }} onChange={() => setDirty(true)}>
      <h2 className="font-medium">Новый профиль</h2><label className="block text-sm">Имя или название команды<Input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">Тип<select className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="person">Человек</option><option value="team">Команда / студия</option></select></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Разрешаю хранить профиль и материалы с доступом участников этого пространства</label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy || !ack}>Создать профиль</Button>
    </form>}
  </div>;
}
function ProfileDetail({ id, ws, canManage, onDirty, onBusy }: { id: string; ws: string; canManage: boolean; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }) {
  const { api } = useCore(); const cache = useQueryClient();
  const detail = useQuery({ queryKey: ["opportunity-profile", ws, id], queryFn: () => api.getOpportunityProfile(ws, id) });
  const [mode, setMode] = useState<"material" | "fact" | "track" | "preferences">("material");
  const [pendingMode, setPendingMode] = useState<typeof mode | null>(null);
  const [title, setTitle] = useState(""); const [content, setContent] = useState(""); const [trackId, setTrackId] = useState(""); const [factIds, setFactIds] = useState<string[]>([]);
  const [materialType, setMaterialType] = useState<"resume" | "portfolio" | "proposal">("resume");
  const [source, setSource] = useState(""); const [city, setCity] = useState(""); const [salary, setSalary] = useState(""); const [formats, setFormats] = useState<string[]>([]); const [exclusions, setExclusions] = useState(""); const [roles, setRoles] = useState("");
  const [preferencesBase, setPreferencesBase] = useState<OpportunityProfileDetail | null>(null);
  const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false); const [error, setError] = useState(""); const [opened, setOpened] = useState<{ title: string; content: string } | null>(null);
  const materials = useInfiniteQuery({ queryKey: ["opportunity-materials", ws, id], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => api.listOpportunityMaterials(ws, id, pageParam), getNextPageParam: (p) => p.nextCursor ?? undefined });
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  async function action(task: () => Promise<unknown>, clear = false) {
    setBusy(true); setError("");
    try { await task(); if (clear) { setTitle(""); setContent(""); setSource(""); setFactIds([]); setDirty(false); } await Promise.all([cache.invalidateQueries({ queryKey: ["opportunity-profile", ws, id] }), cache.invalidateQueries({ queryKey: ["opportunity-profiles", ws] }), cache.invalidateQueries({ queryKey: ["opportunity-materials", ws, id] })]); }
    catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  async function chooseResume(materialId: string | null) {
    if (!detail.data || dirty) return;
    await action(async () => {
      const updated = await api.selectOpportunityResume(ws, id, { expectedRevision: detail.data.revision, materialId });
      setPreferencesBase((base) => base ? { ...base, ...updated } : null);
    });
  }
  function choose(next: typeof mode, discard = false) {
    if (dirty && !discard) { setPendingMode(next); return; }
    setPendingMode(null);
    setMode(next); setTitle(""); setContent(""); setSource(""); setFactIds([]); setDirty(false); setError("");
    if (next === "preferences" && detail.data) { const p = detail.data; setPreferencesBase(p); setTitle(p.displayName); setCity(p.preferences.city); setSalary(p.preferences.minSalaryNetRub?.toString() ?? ""); setFormats(p.preferences.workFormats); setExclusions(p.preferences.excludedCompanies.join("\n")); setRoles(p.preferences.excludedRoles.join("\n")); }
  }
  async function save() {
    await action(async () => {
      if (mode === "material") return api.addOpportunityMaterial(ws, id, createOpportunityMaterialInputSchema.parse({ title, type: materialType, content, trackId: trackId || null }));
      if (mode === "fact") return api.addOpportunityFact(ws, id, createOpportunityFactInputSchema.parse({ statement: content, source }));
      if (mode === "track") return api.addOpportunityTrack(ws, id, createOpportunityTrackInputSchema.parse({ name: title, factIds }));
      const base = preferencesBase; if (!base) throw new Error("Загрузите профиль перед изменением предпочтений");
      const updated = await api.updateOpportunityProfile(ws, id, updateOpportunityProfileInputSchema.parse({ expectedRevision: base.revision, displayName: title, preferences: { city, minSalaryNetRub: salary.trim() ? Number(salary) : null, workFormats: formats, excludedCompanies: exclusions.split("\n").filter((s) => s.trim()), excludedRoles: roles.split("\n").filter((s) => s.trim()) } }));
      setPreferencesBase({ ...base, ...updated }); setTitle(updated.displayName); setDirty(false); return updated;
    }, mode !== "preferences");
  }
  if (detail.isLoading) return <Skeleton className="h-40" />;
  if (!detail.data) return <p role="alert">{describeError(detail.error)}</p>;
  const p = detail.data;
  return <div className="space-y-4"><ConfirmDialog open={pendingMode !== null} title="Сменить форму без сохранения?" description="Введённые данные останутся несохранёнными и будут потеряны." confirmLabel="Сменить форму" danger={false} onCancel={() => setPendingMode(null)} onConfirm={() => { if (pendingMode) choose(pendingMode, true); }} /><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-medium">{p.displayName}</h2>{canManage && <Button variant="outline" disabled={busy || dirty} onClick={() => void action(() => api.updateOpportunityProfile(ws, id, { expectedRevision: p.revision, archivedAt: p.archivedAt ? null : new Date().toISOString() }))}>{p.archivedAt ? "Восстановить профиль" : "В архив"}</Button>}</div>
    <p className="text-sm text-muted-foreground">{p.preferences.city || "Город не указан"} · Минимум на руки: {p.preferences.minSalaryNetRub ?? "не указан"} ₽ · {p.preferences.workFormats.map((f) => ({ remote: "Удалённо", hybrid: "Гибрид", office: "Офис" })[f]).join(", ") || "Формат не указан"}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error} Ввод сохранён.</p>}
    <section className="space-y-2"><h3 className="font-medium">Факты ({p.facts.length})</h3>{!p.facts.length && <p className="text-sm text-muted-foreground">Фактов пока нет. Текст резюме не подтверждает их автоматически.</p>}{p.facts.map((f) => <div key={f.id} className="rounded-lg border border-border p-3 text-sm"><p>{f.statement}</p><p className="text-muted-foreground">Источник: {f.source} · {f.state === "confirmed" ? "Подтверждён владельцем" : f.state === "disputed" ? "Оспорен" : "Не проверен"}</p>{canManage && !p.archivedAt && <div className="mt-2 flex flex-wrap gap-2">{(["confirmed", "disputed", "unverified"] as const).filter((s) => s !== f.state).map((s) => <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => void action(() => api.setOpportunityFactState(ws, id, f.id, { expectedRevision: f.revision, state: s }))}>{s === "confirmed" ? "Подтвердить факт" : s === "disputed" ? "Оспорить" : "Снять подтверждение"}</Button>)}</div>}</div>)}</section>
    <section className="space-y-2"><h3 className="font-medium">Треки</h3>{p.tracks.map((t) => <p key={t.id} className="text-sm">{t.name} · фактов: {t.factIds.length}</p>)}</section>
    <section className="space-y-2" aria-label="Активное резюме"><h3 className="font-medium">Активное резюме</h3><p className="text-sm">{p.activeResume ? p.activeResume.title : p.activeResumeMaterialId ? "Выбранная версия недоступна" : "Пока не выбрано"}</p><p className="text-xs text-muted-foreground">Выбор относится только к этому профилю. Новая версия или импорт не меняют его автоматически и не отправляют резюме.</p>{p.activeResume && <><p className="break-words text-xs text-muted-foreground">{new Date(p.activeResume.createdAt).toLocaleString("ru-RU")} · {p.activeResume.sourcePath || "Создано вручную"}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => void action(async () => { const m = await api.getOpportunityMaterial(ws, id, p.activeResume!.id); setOpened(m); })}>Открыть активное резюме</Button></>}{canManage && !p.archivedAt && p.activeResumeMaterialId && <Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => void chooseResume(null)}>Снять выбор резюме</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={() => void detail.refetch()}>Обновить профиль</Button>{dirty && <p className="text-xs text-muted-foreground">Сохраните или отмените изменения формы перед выбором резюме.</p>}</section>
    <section className="space-y-2"><h3 className="font-medium">Версии материалов</h3>{materials.isError && <p role="alert">{describeError(materials.error)}</p>}{materials.data?.pages.flatMap((page) => page.items).map((m) => <div key={m.id} className="flex flex-wrap items-center gap-2 text-sm"><Button variant="outline" size="sm" disabled={busy} onClick={() => void action(async () => { const data = await api.getOpportunityMaterial(ws, id, m.id); setOpened(data); })}>{m.title}</Button><span className="text-muted-foreground">{new Date(m.createdAt).toLocaleString("ru-RU")} · {m.sourcePath || "Создан вручную"}</span>{m.id === p.activeResumeMaterialId ? <span className="text-sm font-medium">Активное резюме</span> : canManage && !p.archivedAt && m.type === "resume" && <Button variant="outline" size="sm" disabled={busy || dirty} aria-label={`Выбрать активным резюме «${m.title}»`} onClick={() => void chooseResume(m.id)}>Сделать активным</Button>}</div>)}{materials.hasNextPage && <Button variant="outline" disabled={materials.isFetchingNextPage} onClick={() => void materials.fetchNextPage()}>Ещё версии</Button>}
      {opened && <div className="space-y-2 rounded-lg border border-border p-3"><div className="flex items-center justify-between"><strong>{opened.title}</strong><Button size="sm" variant="ghost" onClick={() => setOpened(null)}>Закрыть материал</Button></div><pre className="whitespace-pre-wrap break-words text-sm">{opened.content}</pre></div>}
    </section>
    {canManage && !p.archivedAt && <form className="space-y-3 rounded-xl border border-border p-4" onChange={() => setDirty(true)} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="flex flex-wrap gap-2">{(["material", "fact", "track", "preferences"] as const).map((m) => <Button key={m} type="button" variant={mode === m ? "primary" : "outline"} disabled={busy} onClick={() => choose(m)}>{({ material: "Новая версия", fact: "Добавить факт", track: "Новый трек", preferences: "Предпочтения" })[m]}</Button>)}</div>
      {mode !== "fact" && <label className="block text-sm">{mode === "preferences" ? "Имя / название" : "Название"}<Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>}
      {mode === "material" && <label className="block text-sm">Вид материала<select className={fieldClass} value={materialType} onChange={(e) => setMaterialType(e.target.value as typeof materialType)}><option value="resume">Резюме</option><option value="portfolio">Портфолио</option><option value="proposal">Предложение</option></select></label>}
      {(mode === "material" || mode === "fact") && <label className="block text-sm">{mode === "fact" ? "Формулировка факта" : "Текст материала"}<textarea required maxLength={mode === "fact" ? 2000 : 50000} className={`${fieldClass} min-h-32`} value={content} onChange={(e) => setContent(e.target.value)} /></label>}
      {mode === "fact" && <label className="block text-sm">Источник факта<Input required maxLength={1000} value={source} onChange={(e) => setSource(e.target.value)} /></label>}
      {mode === "material" && <><label className="block text-sm">Трек<select className={fieldClass} value={trackId} onChange={(e) => setTrackId(e.target.value)}><option value="">Без трека</option>{p.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><p className="text-xs text-muted-foreground">Сохраняется новая неизменяемая версия. Предыдущие материалы остаются.</p></>}
      {mode === "track" && <fieldset className="space-y-2"><legend className="text-sm">Факты трека</legend>{p.facts.map((f) => <label key={f.id} className="flex gap-2 text-sm"><input type="checkbox" checked={factIds.includes(f.id)} onChange={(e) => setFactIds((ids) => e.target.checked ? [...ids, f.id] : ids.filter((v) => v !== f.id))} />{f.statement}</label>)}</fieldset>}
      {mode === "preferences" && <><label className="block text-sm">Город<Input value={city} onChange={(e) => setCity(e.target.value)} /></label><label className="block text-sm">Минимум на руки, ₽<Input type="number" min="0" value={salary} onChange={(e) => setSalary(e.target.value)} /></label><fieldset className="flex gap-3"><legend className="text-sm">Формат работы</legend>{(["remote", "hybrid", "office"] as const).map((f) => <label key={f} className="text-sm"><input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats((all) => e.target.checked ? [...all, f] : all.filter((v) => v !== f))} /> {({ remote: "Удалённо", hybrid: "Гибрид", office: "Офис" })[f]}</label>)}</fieldset><label className="block text-sm">Исключённые компании, по одной в строке<textarea className={fieldClass} value={exclusions} onChange={(e) => setExclusions(e.target.value)} /></label><label className="block text-sm">Исключённые роли, по одной в строке<textarea className={fieldClass} value={roles} onChange={(e) => setRoles(e.target.value)} /></label></>}
      <Button type="submit" disabled={busy || !dirty}>Сохранить</Button>{mode === "preferences" && <Button type="button" variant="outline" disabled={busy} onClick={() => void action(async () => { const fresh = await api.getOpportunityProfile(ws, id); setPreferencesBase(fresh); })}>Принять новую версию для повторного сохранения</Button>}
    </form>}
  </div>;
}
