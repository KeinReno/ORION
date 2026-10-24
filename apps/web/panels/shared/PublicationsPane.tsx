"use client";

import { useCore, useSession, useWorkspaces } from "@orion/core-react";
import { publicationStatusInputSchema, type PublicationKind, type PublicationPreview, type PublicationSource, type PublicationStatusInput, type SharedPublication, type TaskStatus, type Workspace } from "@orion/shared-types";
import { Button } from "@orion/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { describeError } from "../../lib/error-message";

const control = "min-h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground";
const statuses: Record<TaskStatus, string> = { backlog: "В планах", todo: "К выполнению", in_progress: "В работе", done: "Выполнено", canceled: "Отменено" };

export function PublicationsPane() {
  const { api } = useCore();
  const session = useSession();
  const spaces = useWorkspaces();
  const [zone, setZone] = useState("");
  const [view, setView] = useState<"zone" | "pinned" | "issued">("zone");
  const [compose, setCompose] = useState(false);
  const workspaceId = zone || spaces.data?.find(s => !s.isPersonal)?.id || "";
  const userId = session.user?.id ?? "";
  const query = useQuery({ queryKey: ["publications", api.serverIdentity, userId, view, workspaceId], enabled: !!userId && (view === "issued" || !!workspaceId), queryFn: () => view === "issued" ? api.issuedPublications() : view === "pinned" ? api.pinnedPublications(workspaceId) : api.listPublications(workspaceId), refetchInterval: 15000 });
  if (spaces.isLoading) return <p role="status">Загружаю пространства…</p>;
  if (spaces.isError) return <p role="alert">{describeError(spaces.error)}</p>;
  return <section className="space-y-4" aria-label="Общие публикации">
    <p className="text-body text-subtle-foreground">Выбранные материалы для участников общего пространства. Все участники должны подключиться к одному серверу ORION.</p>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setCompose(v => !v)} aria-expanded={compose}>Поделиться</Button>
      <Button variant="outline" onClick={() => void query.refetch()}>Обновить</Button>
    </div>
    {compose && <PublishForm spaces={spaces.data ?? []} onPublished={id => { setZone(id); setView("zone"); setCompose(false); void query.refetch(); }} />}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-caption">Список<select className={control} value={view} onChange={e => { const next = e.target.value as typeof view; setView(next); if (next === "pinned") setZone(spaces.data?.find(s => s.isPersonal)?.id ?? ""); if (next === "zone") setZone(spaces.data?.find(s => !s.isPersonal)?.id ?? ""); }}><option value="zone">Общая зона</option><option value="pinned">Показывать у меня</option><option value="issued">Мои публикации</option></select></label>
      {view !== "issued" && <label className="space-y-1 text-caption">Пространство<select className={control} value={workspaceId} onChange={e => setZone(e.target.value)}><option value="">Выберите пространство</option>{(spaces.data ?? []).filter(s => view === "pinned" || !s.isPersonal).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    </div>
    {query.isFetching && <p role="status" className="text-caption">Обновляю список…</p>}
    {query.isError && <p role="alert">Не удалось обновить список: {describeError(query.error)}. Показанные данные могут быть устаревшими.</p>}
    {!workspaceId && view !== "issued" && <p>Создайте общее пространство и пригласите участников через настройки пространства.</p>}
    {query.isSuccess && !query.data.length && <p className="rounded-xl border border-dashed border-border p-6 text-subtle-foreground">Здесь пока нет публикаций. Нажмите «Поделиться», чтобы выбрать отдельную задачу или материал базы знаний.</p>}
    {query.data?.length === 200 && <p className="text-caption">Показаны последние 200 публикаций.</p>}
    <div className="space-y-3">{query.data?.map(p => <PublicationCard key={`${api.serverIdentity}:${userId}:${p.id}`} publication={p} spaces={spaces.data ?? []} userId={userId} pinnedIn={view === "pinned" ? workspaceId : undefined} />)}</div>
  </section>;
}

function PublishForm({ spaces, onPublished }: { spaces: Workspace[]; onPublished: (workspaceId: string) => void }) {
  const { api } = useCore();
  const cache = useQueryClient();
  const [sourceWorkspaceId, setSourceWorkspace] = useState(spaces.find(s => s.role === "owner")?.id ?? "");
  const [workspaceId, setWorkspace] = useState(spaces.find(s => !s.isPersonal && s.id !== sourceWorkspaceId)?.id ?? "");
  const [kind, setKind] = useState<PublicationKind>("task");
  const [sourceId, setSourceId] = useState("");
  const [includeText, setText] = useState(false);
  const [includeDueAt, setDueAt] = useState(false);
  const [allowStatus, setAllowStatus] = useState(false);
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const source: PublicationSource = { sourceWorkspaceId, sourceId, kind, includeText, includeDueAt };
  const items = useQuery({ queryKey: ["publication-sources", api.serverIdentity, sourceWorkspaceId, kind], enabled: !!sourceWorkspaceId, queryFn: async () => (kind === "task" ? await api.listTasks(sourceWorkspaceId) : await api.listKnowledgeItems(sourceWorkspaceId)).map(i => ({ id: i.id, title: i.title })) });
  const members = useQuery({ queryKey: ["publication-members", workspaceId], enabled: !!workspaceId, queryFn: () => api.listWorkspaceMembers(workspaceId) });
  function changed() { setPreview(null); setError(""); }
  async function submit(publish: boolean) {
    setBusy(true); setError("");
    try {
      if (publish && preview) { await api.createPublication({ ...source, workspaceId, allowStatus, fingerprint: preview.fingerprint }); await cache.invalidateQueries({ queryKey: ["publications"] }); onPublished(workspaceId); }
      else setPreview(await api.previewPublication(source));
    } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  return <fieldset disabled={busy} className="space-y-3 rounded-xl border border-border bg-card p-4">
    <legend className="px-2 font-medium">Поделиться выбранным материалом</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Откуда<select className={control} value={sourceWorkspaceId} onChange={e => { setSourceWorkspace(e.target.value); setSourceId(""); changed(); }}>{spaces.filter(s => s.role === "owner").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Что передать<select className={control} value={kind} onChange={e => { setKind(e.target.value as PublicationKind); setSourceId(""); setAllowStatus(false); setDueAt(false); changed(); }}><option value="task">Задача</option><option value="knowledge">Материал базы знаний</option></select></label>
    </div>
    <label className="block">Материал<select className={control} value={sourceId} onChange={e => { setSourceId(e.target.value); changed(); }}><option value="">Выберите материал</option>{items.data?.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
    {items.isError && <p role="alert">{describeError(items.error)}</p>}
    <label className="block">Общая зона<select className={control} value={workspaceId} onChange={e => { setWorkspace(e.target.value); changed(); }}><option value="">Выберите общее пространство</option>{spaces.filter(s => !s.isPersonal && s.id !== sourceWorkspaceId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {members.isError && <p role="alert">Не удалось проверить состав участников: {describeError(members.error)}</p>}
    <p className="text-caption text-subtle-foreground">Доступ получат все текущие и будущие участники этой зоны. {members.data ? `Сейчас: ${members.data.map(m => m.name).join(", ")}.` : ""} Состав участников меняется в настройках пространства.</p>
    <label className="flex gap-2"><input type="checkbox" checked={includeText} onChange={e => { setText(e.target.checked); changed(); }} />Передать текст</label>
    {kind === "task" && <><label className="flex gap-2"><input type="checkbox" checked={includeDueAt} onChange={e => { setDueAt(e.target.checked); changed(); }} />Передать срок</label><label className="flex gap-2"><input type="checkbox" checked={allowStatus} onChange={e => { setAllowStatus(e.target.checked); changed(); }} />Разрешить участникам менять статус оригинальной задачи</label></>}
    <p className="text-caption text-subtle-foreground">Вложения, источники, связи, проект и исполнители не передаются. Ссылки удаляются из текста. Проверьте сам текст: он тоже может содержать личные сведения.</p>
    {preview && <div className="space-y-2 rounded-lg border border-border p-3"><p className="text-caption">Участники увидят именно это:</p><Content content={preview.content} /><p className="text-caption">{allowStatus ? "Статус можно менять без дополнительного подтверждения владельца, пока сервер доступен." : "Только чтение."} Новые изменения текста оригинала автоматически не публикуются.</p></div>}
    {error && <p role="alert">{error}</p>}
    <Button disabled={!sourceId || !workspaceId || busy || members.isLoading || members.isError} onClick={() => void submit(!!preview)}>{busy ? "Ожидаю ответ сервера…" : preview ? "Опубликовать для участников" : "Предварительный просмотр"}</Button>
  </fieldset>;
}

function Content({ content }: { content: SharedPublication["content"] }) {
  return <><h3 className="break-words font-medium">{content.title}</h3>{content.status && <p className="text-caption">Статус: {statuses[content.status]}</p>}{content.dueAt && <p className="text-caption">Срок: {new Date(content.dueAt).toLocaleString("ru-RU")}</p>}{content.text && <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-body">{content.text}</p>}</>;
}

function PublicationCard({ publication: p, spaces, userId, pinnedIn }: { publication: SharedPublication; spaces: Workspace[]; userId: string; pinnedIn?: string }) {
  const { api } = useCore();
  const cache = useQueryClient();
  const key = `orion.publication-intent:${encodeURIComponent(api.serverIdentity)}:${userId}:${p.id}`;
  const [pending, setPending] = useState<PublicationStatusInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState<(PublicationPreview & { expectedRevision: number }) | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [destination, setDestination] = useState(spaces.find(s => s.isPersonal)?.id ?? "");
  const [status, setStatus] = useState<TaskStatus | null>(null);
  useEffect(() => { try { const raw = localStorage.getItem(key); if (raw) setPending(publicationStatusInputSchema.parse(JSON.parse(raw))); } catch { setMessage("Не удалось прочитать ожидающее изменение из локального хранилища."); } }, [key]);
  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); setMessage(success); await cache.invalidateQueries({ queryKey: ["publications"] }); }
    catch (e) { setMessage(describeError(e)); } finally { setBusy(false); }
  }
  async function sendStatus() {
    const intent = pending ?? { operationId: crypto.randomUUID(), expectedRevision: p.revision, status: status ?? p.content.status ?? "todo" };
    await act(async () => {
      // Persist before delivery: a lost response can be retried with the same operation id.
      localStorage.setItem(key, JSON.stringify(intent)); setPending(intent);
      await api.updatePublicationStatus(p.id, intent);
      localStorage.removeItem(key); setPending(null); setStatus(null);
    }, "Статус применён сервером к общей публикации и оригиналу.");
  }
  const personal = spaces.find(s => s.id === destination)?.isPersonal;
  return <article className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={p.content.title}>
    <p className="text-caption text-subtle-foreground">{p.kind === "task" ? "Задача" : "База знаний"} · {spaces.find(s => s.id === p.workspaceId)?.name ?? "Общая зона"} · версия {p.revision}</p>
    <Content content={p.content} />
    {p.allowStatus && <div className="space-y-2"><label className="block">Новый статус<select className={control} value={pending?.status ?? status ?? p.content.status ?? "todo"} disabled={busy || !!pending} onChange={e => setStatus(e.target.value as TaskStatus)}>{Object.entries(statuses).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      {pending && <p role="status">Изменение ожидает подтверждения. При потере связи нажмите «Повторить отправку», когда сервер станет доступен. Конфликт требует отменить это намерение и выбрать статус заново после обновления списка.</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void sendStatus()}>{pending ? "Повторить отправку" : "Изменить статус"}</Button>{pending && <Button variant="outline" disabled={busy} onClick={() => { try { localStorage.removeItem(key); setPending(null); setMessage("Локальное намерение удалено. Если сервер уже применил его, это не отменяет изменение — обновите список."); } catch { setMessage("Не удалось удалить локальное намерение."); } }}>Удалить локальное намерение</Button>}</div>
    </div>}
    <label className="block text-caption">У меня в пространстве<select className={control} value={destination} onChange={e => setDestination(e.target.value)}><option value="">Выберите пространство</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || !destination} onClick={() => void act(() => api.pinPublication(p.id, destination), "Публикация добавлена в список «Показывать у меня».")}>Показывать у меня</Button>
      <Button variant="outline" disabled={busy || !personal} onClick={() => void act(() => api.copyPublication(p.id, destination), "Личная копия создана. Она больше не синхронизируется с публикацией.")}>Сделать личную копию</Button>
      {pinnedIn && <Button variant="ghost" disabled={busy} onClick={() => void act(() => api.unpinPublication(p.id, pinnedIn), "Убрано из вашего списка.")}>Убрать из моего списка</Button>}
      {p.canManage && <Button variant="outline" disabled={busy} onClick={() => void act(async () => { const preview = await api.previewPublicationRefresh(p.id); setRefresh({ ...preview, expectedRevision: p.revision }); }, "Проверьте обновлённый текст перед публикацией.")}>Обновить из оригинала</Button>}
      {p.canManage && <Button variant="danger" disabled={busy} onClick={() => setConfirmRevoke(true)}>Отозвать доступ</Button>}
    </div>
    <p className="text-caption text-subtle-foreground">Личная копия доступна в личном пространстве и сохраняется после отзыва публикации. Копия задачи создаётся как новая задача к выполнению.</p>
    {refresh && <div className="space-y-2 rounded-lg border border-border p-3"><p>Новая версия для всех участников:</p><Content content={refresh.content} /><Button disabled={busy} onClick={() => void act(async () => { await api.refreshPublication(p.id, { expectedRevision: refresh.expectedRevision, fingerprint: refresh.fingerprint }); setRefresh(null); }, "Обновлённая версия опубликована.")}>Опубликовать обновление</Button> <Button variant="outline" disabled={busy} onClick={() => setRefresh(null)}>Отмена</Button></div>}
    {confirmRevoke && <div className="space-y-2 rounded-lg border border-border p-3"><p>Закрыть доступ всем участникам? Публикация исчезнет из их списков. Уже сделанные личные копии сохранятся.</p><Button variant="danger" disabled={busy} onClick={() => void act(() => api.revokePublication(p.id), "Доступ отозван.")}>Отозвать для всех</Button> <Button variant="outline" disabled={busy} onClick={() => setConfirmRevoke(false)}>Оставить доступ</Button></div>}
    {busy && <p role="status">Ожидаю подтверждение сервера…</p>}
    {message && <p role="status" className="text-caption">{message}</p>}
  </article>;
}
