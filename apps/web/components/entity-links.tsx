"use client";

import {
  useCancelReminder,
  useCreateAndLink,
  useCreateEntityLink,
  useCreateReminder,
  useDeleteEntityLink,
  useEntityLinks,
  useGlobalSearch,
  useReminders
} from "@orion/core-react";
import { RELATION_KIND_CATALOG, type GlobalSearchResult, type SearchableEntityType } from "@orion/shared-types";
import { Button, IconButton, Input, Skeleton, Textarea, cx, useToast } from "@orion/ui";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderKanban,
  Link2,
  ListTodo,
  PlusCircle,
  Receipt,
  StickyNote,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { computeLinkOptions, type EntityLinkOption } from "../lib/entity-link-options";
import { describeError } from "../lib/error-message";
import { focusDocument, focusEvent, focusNote, focusProject, focusTask, focusTransaction } from "../lib/panel-bus";

const TYPE_ICON: Record<SearchableEntityType, LucideIcon> = {
  project: FolderKanban,
  task: ListTodo,
  note: StickyNote,
  event: CalendarDays,
  document: FileText,
  transaction: Receipt
};

const TYPE_LABEL: Record<SearchableEntityType, string> = {
  project: "проект",
  task: "задача",
  note: "заметка",
  event: "событие",
  document: "документ",
  transaction: "операция"
};

/** Opens the target's own panel — reuses the existing panel-bus focus channels, no new navigation. */
const FOCUS_BY_TYPE: Partial<Record<SearchableEntityType, (id: string) => void>> = {
  task: focusTask,
  note: focusNote,
  event: focusEvent,
  document: focusDocument,
  transaction: focusTransaction,
  project: focusProject
};

/**
 * «Связанные записи» — typed links between any two entities (`entity_links`).
 *
 * U02 (24-CONNECTED-CORE-BACKLOG.md): the picker now offers an explicit
 * `RelationKind` instead of an implicit `related_to` (U01 shipped the
 * typed catalog + pair validation with no UI for it). When a pair only has
 * one valid kind — the common case — the kind choice is skipped entirely
 * (no picking from a list of one). Existing links show the catalog label
 * from *this* entity's side (`label` when this is the source, `reverseLabel`
 * when this is the target), and clicking one opens the target's own panel
 * through the existing panel-bus focus channels (no new navigation).
 *
 * The block stays collapsed when there is nothing to show and the user
 * hasn't asked for it: a header row with a count (only if > 0) plus a
 * "Связать" toggle. Zero links renders no body until the user opens the
 * picker — per 23-UNIVERSAL-CONNECTED-CORE.md, related groups show up "по
 * наличию и запросу пользователя", not as a standing empty state.
 *
 * Picking a target reuses the global search endpoint (`q` ≥ 2 chars) instead
 * of suspending a full list of every task/note/document in the workspace.
 * The typed text survives a failed create (network error): only a
 * successful link clears the query and closes the picker.
 */
export function EntityLinksSection({
  workspaceId,
  type,
  id
}: {
  workspaceId: string | undefined;
  type: SearchableEntityType;
  id: string | undefined;
}): React.ReactElement {
  const { data: linkPage, isLoading } = useEntityLinks(workspaceId, type, id ?? "");
  const links = linkPage?.items;
  const createLink = useCreateEntityLink(workspaceId);
  const deleteLink = useDeleteEntityLink(workspaceId);
  const createAndLink = useCreateAndLink(workspaceId);
  const { toast } = useToast();

  // U03 Часть 1: "Создать задачу" / "Написать заметку" — a minimal inline
  // form whose submit goes through `createAndLink` (one atomic server
  // transaction: new entity + link, see SearchService.createAndLink), not
  // two separate create/link calls. `submitLockRef` disables the button the
  // instant the click handler runs (before the request even starts) — the
  // ONLY guard against a double-click here; a retry after a real network
  // timeout is not deduplicated server-side (see createAndLinkInputSchema's
  // doc comment). This is a documented, accepted gap for this slice.
  const [creatingKind, setCreatingKind] = useState<"task" | "note" | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const submitLockRef = useRef(false);

  async function commitCreateAndLink(): Promise<void> {
    if (!id || !creatingKind || submitLockRef.current) return;
    const title = newTitle.trim();
    if (!title) return;
    submitLockRef.current = true;
    try {
      await createAndLink.mutateAsync({
        targetType: type,
        targetId: id,
        kind: "related_to",
        entity:
          creatingKind === "task"
            ? { type: "task", input: { title, description: newBody.trim(), priority: "normal" } }
            : { type: "note", input: { title, body: newBody, tags: [] } }
      });
      setCreatingKind(null);
      setNewTitle("");
      setNewBody("");
      toast({ title: creatingKind === "task" ? "Задача создана и связана" : "Заметка создана и связана", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать", description: describeError(error), tone: "danger" });
    } finally {
      submitLockRef.current = false;
    }
  }

  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SearchableEntityType | null>(null);
  const [pendingCandidate, setPendingCandidate] = useState<GlobalSearchResult | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const { data: hits, isFetching } = useGlobalSearch(workspaceId, query);

  // U03: personal one-shot reminder for this entity. `useReminders` returns
  // the caller's own reminders workspace-wide (small, bounded set — no
  // separate per-entity endpoint yet) — filtered client-side to this entity.
  const [remindPicking, setRemindPicking] = useState(false);
  const [remindAt, setRemindAt] = useState("");
  const { data: allReminders } = useReminders(workspaceId);
  const createReminder = useCreateReminder(workspaceId);
  const cancelReminder = useCancelReminder(workspaceId);
  const pendingReminders = (allReminders ?? []).filter(
    (r) => r.entityType === type && r.entityId === id && r.status === "pending"
  );

  async function commitReminder(): Promise<void> {
    if (!remindAt) return;
    const local = new Date(remindAt);
    if (Number.isNaN(local.getTime())) return;
    try {
      await createReminder.mutateAsync({
        entityType: type,
        entityId: id as string,
        scheduledAt: local.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
      setRemindAt("");
      setRemindPicking(false);
      toast({ title: "Напоминание создано", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать напоминание", description: describeError(error), tone: "danger" });
    }
  }

  const others = (links ?? []).map((link) => {
    const outgoing = link.sourceType === type && link.sourceId === id;
    const def = RELATION_KIND_CATALOG[link.kind];
    return {
      link,
      type: (outgoing ? link.targetType : link.sourceType) as SearchableEntityType,
      id: outgoing ? link.targetId : link.sourceId,
      title: link.title,
      // Symmetric related_to reads the same from both sides; directed kinds
      // read differently depending on whether "this" entity is the source or the target.
      perspectiveLabel: def.symmetric ? def.label : outgoing ? def.label : def.reverseLabel
    };
  });
  const linkedKeys = new Set(others.map((other) => `${other.type}:${other.id}`));

  const candidates = useMemo(() => {
    return (hits ?? [])
      .filter((hit) => !(hit.type === type && hit.id === id) && !linkedKeys.has(`${hit.type}:${hit.id}`))
      .filter((hit) => !typeFilter || hit.type === typeFilter)
      .filter((hit) => id !== undefined && computeLinkOptions(type, id, hit.type, hit.id).length > 0);
    // linkedKeys is a new Set every render; comparing its content isn't worth it here — candidates
    // recompute is cheap (bounded by search page size) and this only reruns when hits/filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, type, id, typeFilter, links]);

  const candidateTypes = useMemo(() => Array.from(new Set((hits ?? []).map((hit) => hit.type))), [hits]);

  async function commitLink(option: EntityLinkOption): Promise<void> {
    try {
      await createLink.mutateAsync({
        sourceType: option.sourceType,
        sourceId: option.sourceId,
        targetType: option.targetType,
        targetId: option.targetId,
        kind: option.kind,
        label: null
      });
      setQuery("");
      setPicking(false);
      setPendingCandidate(null);
      setActiveIndex(0);
      toast({ title: "Связь добавлена", tone: "success" });
    } catch (error) {
      // Preserve the typed query/candidate so a network error doesn't lose input (rule/preserve-user-input).
      toast({ title: "Не удалось связать", description: describeError(error), tone: "danger" });
    }
  }

  function selectCandidate(hit: GlobalSearchResult): void {
    if (!id) return;
    const options = computeLinkOptions(type, id, hit.type, hit.id);
    if (options.length === 0) return;
    if (options.length === 1) {
      void commitLink(options[0]);
      return;
    }
    setPendingCandidate(hit);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!picking || pendingCandidate || candidates.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = candidates[activeIndex];
      if (hit) selectCandidate(hit);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setPicking(false);
    }
  }

  const pendingOptions = pendingCandidate && id ? computeLinkOptions(type, id, pendingCandidate.type, pendingCandidate.id) : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className="flex items-center gap-1.5 text-2xs text-subtle-foreground hover:text-foreground"
        >
          {picking ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Link2 className="h-3.5 w-3.5" /> Связанные записи
          {others.length > 0 ? <span className="text-subtle-foreground">· {others.length}</span> : null}
        </button>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={!id}
            onClick={() => {
              setPicking(false);
              setCreatingKind((v) => (v === "task" ? null : "task"));
            }}
          >
            <PlusCircle className="h-3.5 w-3.5" /> Задача
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={!id}
            onClick={() => {
              setPicking(false);
              setCreatingKind((v) => (v === "note" ? null : "note"));
            }}
          >
            <PlusCircle className="h-3.5 w-3.5" /> Заметка
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="h-6 px-2 text-2xs"
            onClick={() => {
              setCreatingKind(null);
              setPicking((v) => !v);
            }}
          >
            {picking ? <X className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} {picking ? "Отмена" : "Связать"}
          </Button>
        </div>
      </div>

      {/* U03 Часть 1: "Создать задачу"/"Написать заметку" — atomic create-and-link. */}
      {creatingKind ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-white/[0.02] p-2">
          <Input
            autoFocus
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder={creatingKind === "task" ? "Заголовок задачи" : "Заголовок заметки"}
          />
          <Textarea
            value={newBody}
            onChange={(event) => setNewBody(event.target.value)}
            placeholder={creatingKind === "task" ? "Описание (необязательно)" : "Текст заметки (необязательно)"}
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!newTitle.trim() || createAndLink.isPending}
              onClick={() => void commitCreateAndLink()}
            >
              Создать и связать
            </Button>
            <Button type="button" variant="subtle" size="sm" onClick={() => setCreatingKind(null)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}

      {picking ? (
        <div className="rounded-lg border border-border bg-white/[0.02] p-2">
          {pendingCandidate ? (
            <div className="flex flex-col gap-2">
              <p className="text-2xs text-subtle-foreground">
                Как связать с «{pendingCandidate.title || "Без названия"}» ({TYPE_LABEL[pendingCandidate.type]})?
              </p>
              <div className="flex flex-col gap-1">
                {pendingOptions.map((option) => (
                  <button
                    key={`${option.kind}:${option.sourceType}:${option.sourceId}:${option.targetType}:${option.targetId}`}
                    type="button"
                    disabled={createLink.isPending}
                    onClick={() => void commitLink(option)}
                    className="rounded-md border border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  >
                    {option.perspectiveLabel}
                  </button>
                ))}
              </div>
              <Button type="button" variant="subtle" size="sm" className="self-start" onClick={() => setPendingCandidate(null)}>
                Назад
              </Button>
            </div>
          ) : (
            <>
              <Input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleListKeyDown}
                placeholder="Найти задачу, заметку, событие, проект…"
              />
              {candidateTypes.length > 1 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setTypeFilter(null)}
                    className={cx(
                      "rounded-full border px-2 py-0.5 text-2xs",
                      typeFilter === null ? "border-accent text-accent" : "border-border text-subtle-foreground"
                    )}
                  >
                    Все
                  </button>
                  {candidateTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter((cur) => (cur === t ? null : t))}
                      className={cx(
                        "rounded-full border px-2 py-0.5 text-2xs",
                        typeFilter === t ? "border-accent text-accent" : "border-border text-subtle-foreground"
                      )}
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              ) : null}
              {query.trim().length >= 2 ? (
                <ul ref={listRef} className="orion-scroll mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                  {candidates.map((hit, index) => {
                    const Icon = TYPE_ICON[hit.type];
                    return (
                      <li key={`${hit.type}:${hit.id}`}>
                        <button
                          type="button"
                          disabled={createLink.isPending}
                          onClick={() => selectCandidate(hit)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cx(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground",
                            index === activeIndex ? "bg-white/5 text-foreground" : ""
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-subtle-foreground" />
                          <span className="flex-1 truncate">{hit.title || "Без названия"}</span>
                          <span className="text-2xs text-subtle-foreground">{TYPE_LABEL[hit.type]}</span>
                        </button>
                      </li>
                    );
                  })}
                  {!isFetching && candidates.length === 0 ? (
                    <li className="px-2 py-3 text-center text-2xs text-subtle-foreground">Ничего не найдено</li>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-1.5 text-2xs text-subtle-foreground">Введите хотя бы два символа — ищем по всем модулям.</p>
              )}
            </>
          )}
        </div>
      ) : null}

      {isLoading && picking ? (
        <Skeleton className="h-6 w-40" />
      ) : others.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {others.map((other) => {
            const Icon = TYPE_ICON[other.type];
            const focus = FOCUS_BY_TYPE[other.type];
            return (
              <li
                key={other.link.id}
                className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-2xs text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => focus?.(other.id)}
                  title={other.perspectiveLabel}
                  className="flex items-center gap-1 hover:text-foreground disabled:cursor-default"
                  disabled={!focus}
                >
                  <Icon className="h-3 w-3 shrink-0 text-subtle-foreground" />
                  <span className="max-w-48 truncate">{other.title || "Без названия"}</span>
                  <span className="text-subtle-foreground">{TYPE_LABEL[other.type]}</span>
                </button>
                <IconButton
                  label="Убрать связь"
                  size="sm"
                  className="h-4 w-4"
                  onClick={() => deleteLink.mutate(other.link.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* U03: personal one-shot reminder for this entity. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
            <Bell className="h-3.5 w-3.5" /> Напоминание
          </span>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={!id}
            onClick={() => setRemindPicking((v) => !v)}
          >
            {remindPicking ? <X className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />} {remindPicking ? "Отмена" : "Напомнить"}
          </Button>
        </div>
        {remindPicking ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white/[0.02] p-2">
            <Input
              type="datetime-local"
              value={remindAt}
              onChange={(event) => setRemindAt(event.target.value)}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0"
              disabled={!remindAt || createReminder.isPending}
              onClick={() => void commitReminder()}
            >
              Создать
            </Button>
          </div>
        ) : null}
        {pendingReminders.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {pendingReminders.map((reminder) => (
              <li
                key={reminder.id}
                className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-2xs text-muted-foreground"
              >
                <Bell className="h-3 w-3 shrink-0 text-subtle-foreground" />
                <span>{new Date(reminder.scheduledAt).toLocaleString("ru")}</span>
                <IconButton
                  label="Отменить напоминание"
                  size="sm"
                  className="h-4 w-4"
                  onClick={() => cancelReminder.mutate(reminder.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
