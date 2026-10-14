"use client";

import {
  useCaptureInboxItem,
  useDeleteInboxItem,
  useInbox,
  useProcessInboxItem,
  useProjects
} from "@orion/core-react";
import { localDayDueAt, type InboxItem, type ProcessInboxInput } from "@orion/shared-types";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Select,
  Skeleton,
  useToast
} from "@orion/ui";
import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, Clock, FolderKanban, Inbox, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { SectionTabs, sectionTabTitle, useSectionView, type SectionTab } from "../components/section-tabs";
import type { PanelComponentProps } from "../lib/panel-registry";
import { fromDatetimeLocal, relativeTime, shortDateTime, toDatetimeLocal } from "../lib/format";
import { describeError } from "../lib/error-message";
import { openEntity, openPanel } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { InboxQueue } from "./inbox/queue";
import { groupInboxItems, isInboxGroupBy, type InboxGroupBy } from "./inbox/group";

type InboxView = "queue" | "history";

const INBOX_TABS: SectionTab<InboxView>[] = [
  { value: "queue", label: "К разбору" },
  { value: "history", label: "История" }
];

const GROUP_KEY = "orion.inbox.groupBy";

function loadGroupBy(): InboxGroupBy {
  try {
    const raw = localStorage.getItem(GROUP_KEY);
    if (raw && isInboxGroupBy(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "none";
}

/** The three things an inbox item can become — `item.kind` once processed. */
type ProcessKind = "task" | "note" | "event";

const PROCESS_TITLE: Record<ProcessKind, string> = {
  task: "В задачу",
  note: "В заметку",
  event: "В событие"
};

const PROCESS_DONE: Record<ProcessKind, string> = {
  task: "Задача создана",
  note: "Заметка создана",
  event: "Событие создано"
};

/** Label for the "already processed" badge in the history slice. */
const PROCESSED_LABEL: Record<ProcessKind, string> = {
  task: "→ Задача",
  note: "→ Заметка",
  event: "→ Событие"
};

/** `kind === "inbox"` means "not processed yet" — narrows to the three targets. */
function processedKind(item: InboxItem): ProcessKind | null {
  return item.kind === "inbox" ? null : item.kind;
}

/**
 * Quick capture → triage. One list, two slices: the queue (everything still
 * to be sorted) and the history (what it was turned into and when). Both come
 * from the same endpoint — see `useInbox(workspaceId, history)`.
 */
export function InboxPanel({ params, api }: PanelComponentProps = {}): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const workspaceId = workspace?.id;
  const [viewChoice, setView] = useState<InboxView>("queue");
  const section = useSectionView(params, api, "Инбокс", INBOX_TABS);
  // Opened as a view of ONE tab: that tab, always (the strip is hidden).
  const view: InboxView = section.view ?? viewChoice;
  const history = view === "history";
  const [groupBy, setGroupBy] = useState<InboxGroupBy>("none");
  const grouping = groupBy === "project" && !isEnabled("projects") ? "none" : groupBy;

  useEffect(() => setGroupBy(loadGroupBy()), []);
  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, groupBy);
    } catch {
      /* ignore */
    }
  }, [groupBy]);

  // The badge always counts the queue, even while the history slice is open.
  // Same queryKey while `history` is false, so react-query dedupes the request.
  const queue = useInbox(workspaceId, false);
  const { data, isLoading, isError, error, refetch } = useInbox(workspaceId, history);
  // Only for the project name on a card — the contract carries `projectId`,
  // not a label. Falls back to a generic marker while the list loads.
  const { data: projects } = useProjects(isEnabled("projects") ? workspaceId : undefined);
  const projectNames = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);

  const capture = useCaptureInboxItem(workspaceId);
  const process = useProcessInboxItem(workspaceId);
  const remove = useDeleteInboxItem(workspaceId);
  const { toast } = useToast();

  const [draft, setDraft] = useState("");
  /** Which item is being turned into what, and the due field for that dialog. */
  const [pending, setPending] = useState<{ item: InboxItem; kind: ProcessKind } | null>(null);
  const [dueDraft, setDueDraft] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<InboxItem | null>(null);

  // The badge always shows the real total to-process count — S15: the server
  // caps the response at 250 rows, so `queue.data.items.length` would
  // silently plateau at 250 while the actual queue kept growing.
  const unprocessed = queue.data?.totalCount ?? 0;
  const list = data?.items ?? [];
  // Honest truncation notice (S15 acceptance): only shown when the server
  // actually cut rows, and always states the real total, not the visible count.
  const truncated = data && data.totalCount > data.items.length ? data : null;

  async function submitCapture(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    try {
      await capture.mutateAsync({ title, body: "", kind: "inbox" });
      setDraft("");
      toast({ title: "Добавлено в инбокс", tone: "success" });
    } catch {
      toast({ title: "Не удалось добавить запись", tone: "danger" });
    }
  }

  function openCreated(kind: ProcessKind, targetId: string | null): void {
    if (kind === "task") {
      if (targetId) openEntity("task", targetId);
      else openPanel("tasks");
      return;
    }
    if (kind === "note") {
      if (targetId) openEntity("note", targetId);
      else openPanel("notes");
      return;
    }
    if (targetId) openEntity("event", targetId);
    else openPanel("calendar");
  }

  function defaultDueLocal(item: InboxItem, kind: ProcessKind): string {
    if (item.dueAt) return toDatetimeLocal(item.dueAt);
    if (kind === "event") return toDatetimeLocal(new Date().toISOString());
    return "";
  }

  function openProcess(item: InboxItem, kind: ProcessKind): void {
    setPending({ item, kind });
    setDueDraft(defaultDueLocal(item, kind));
    setProjectDraft(item.projectId ?? "");
  }

  /**
   * Stay on the queue after a successful process — jumping away is how a
   * triage session dies after the first item. The toast's «Открыть» is the
   * opt-in hop to the created entity.
   */
  async function runProcess(item: InboxItem, input: ProcessInboxInput): Promise<void> {
    try {
      const created = await process.mutateAsync({ itemId: item.id, input });
      setPending(null);
      toast({
        title: PROCESS_DONE[input.kind],
        description: created.title,
        tone: "success",
        action: created.targetId
          ? { label: "Открыть", onClick: () => openCreated(input.kind, created.targetId) }
          : undefined
      });
    } catch {
      toast({ title: "Не удалось разобрать запись", tone: "danger" });
    }
  }

  async function confirmProcess(): Promise<void> {
    const target = pending;
    if (!target) return;
    const { item, kind } = target;
    const projectId = isEnabled("projects") ? projectDraft || null : undefined;
    const input: ProcessInboxInput =
      kind === "note"
        ? { kind, projectId }
        : { kind, dueAt: fromDatetimeLocal(dueDraft), projectId };
    await runProcess(item, input);
  }

  function processToday(item: InboxItem): void {
    void runProcess(item, {
      kind: "task",
      dueAt: localDayDueAt(new Date()),
      projectId: item.projectId
    });
  }

  function confirmDelete(): void {
    const item = pendingDelete;
    if (!item) return;
    setPendingDelete(null);
    remove.mutate(item.id, {
      onSuccess: () => toast({ title: "Удалено", tone: "default" }),
      onError: () => toast({ title: "Не удалось удалить", tone: "danger" })
    });
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={Inbox}
        title="Инбокс"
        subtitle={section.locked ? sectionTabTitle(INBOX_TABS.find((tab) => tab.value === view)) : unprocessed > 0 ? `${unprocessed} к разбору` : "Записывайте мысли, разбирайте потом"}
        actions={
          unprocessed > 0 ? (
            <Badge tone="accent">{unprocessed}</Badge>
          ) : (
            <Badge>Чисто</Badge>
          )
        }
      >
        <SectionTabs<InboxView> baseId="inbox" tabs={INBOX_TABS} value={view} onChange={setView} locked={section.locked} size="sm" />
        {history ? (
          <SegmentedControl<InboxGroupBy>
            value={grouping}
            onChange={setGroupBy}
            size="sm"
            options={[
              { value: "none", label: "Все" },
              ...(isEnabled("projects") ? [{ value: "project" as const, label: "По проекту" }] : []),
              { value: "date", label: "По дате" }
            ]}
          />
        ) : null}
      </PanelHeader>

      <PanelBody className="space-y-4">
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <div className="mx-auto w-full max-w-lg space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Inbox}
              title="Нет рабочего пространства"
              description="Инбокс живёт внутри пространства — создайте его или войдите заново."
            />
          )
        ) : (
          <div className="space-y-4">
            {!history ? (
              <form onSubmit={submitCapture} className="mx-auto w-full max-w-xl">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Мысль — Enter, чтобы оставить в очереди"
                  maxLength={500}
                  aria-label="Новая запись в инбокс"
                  disabled={capture.isPending}
                />
              </form>
            ) : null}

            {truncated ? (
              <p className="text-2xs text-subtle-foreground">
                Показаны первые {truncated.items.length} из {truncated.totalCount} — сузьте выборку (например, откройте
                историю отдельно), чтобы увидеть остальные.
              </p>
            ) : null}

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : isError ? (
              <EmptyState
                icon={TriangleAlert}
                tone="danger"
                title="Не удалось загрузить инбокс"
                description={describeError(error)}
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetch()}>
                    Повторить
                  </Button>
                }
              />
            ) : list.length === 0 ? (
              history ? (
                <EmptyState
                  icon={Inbox}
                  title="История пуста"
                  description="Здесь появятся записи, которые вы уже превратили в задачу, заметку или событие."
                />
              ) : (
                <EmptyState icon={CircleCheck} tone="success" title="Инбокс пуст" />
              )
            ) : history ? (
              <div className="mx-auto w-full max-w-xl">
                {groupInboxItems(list, grouping, projectNames).map((group) => (
                  <div key={group.key}>
                    {grouping !== "none" ? (
                      <p className="px-1 pb-1 pt-3 text-micro uppercase tracking-wide text-subtle-foreground">
                        {group.label}
                      </p>
                    ) : null}
                    <ul>
                      <AnimatePresence initial={false}>
                        {group.items.map((item) => {
                          const done = processedKind(item);
                          return (
                            <motion.li
                              key={item.id}
                              layout
                              initial={{ opacity: 0, y: -8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: 40, height: 0, marginBottom: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                            >
                              <div className="flex items-start gap-3 border-b border-border px-1 py-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-body text-foreground">{item.title}</p>
                                  {item.body ? (
                                    <p className="mt-0.5 line-clamp-2 text-label text-muted-foreground">{item.body}</p>
                                  ) : null}
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <span className="text-micro text-subtle-foreground">{relativeTime(item.createdAt)}</span>
                                    {item.projectId ? (
                                      <Badge>
                                        <FolderKanban className="h-3 w-3" />{" "}
                                        {projectNames.get(item.projectId) ?? "Проект"}
                                      </Badge>
                                    ) : null}
                                    {item.dueAt ? (
                                      <Badge>
                                        <Clock className="h-3 w-3" /> {shortDateTime(item.dueAt)}
                                      </Badge>
                                    ) : null}
                                    {done ? (
                                      <button
                                        type="button"
                                        onClick={() => openCreated(done, item.targetId)}
                                        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                                      >
                                        <Badge tone="success">
                                          {PROCESSED_LABEL[done]}
                                          {item.processedAt ? ` · ${relativeTime(item.processedAt)}` : ""}
                                        </Badge>
                                      </button>
                                    ) : item.processedAt ? (
                                      <Badge>Архивировано</Badge>
                                    ) : null}
                                  </div>
                                </div>
                                <IconButton
                                  label="Удалить запись"
                                  size="sm"
                                  tone="danger"
                                  onClick={() => setPendingDelete(item)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </IconButton>
                              </div>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <InboxQueue
                items={list}
                groupBy={grouping}
                projectNames={projectNames}
                isEnabled={isEnabled}
                processPending={process.isPending}
                onProcessToday={processToday}
                onOpenProcess={openProcess}
                onDelete={setPendingDelete}
              />
            )}
          </div>
        )}
      </PanelBody>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? PROCESS_TITLE[pending.kind] : "Разобрать"}
        size="sm"
      >
        {pending ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">«{pending.item.title}»</p>
            {pending.kind === "note" ? (
              <p className="text-xs text-subtle-foreground">
                Текст записи станет телом заметки — заголовок можно будет поправить в панели «Заметки».
              </p>
            ) : (
              <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
                {pending.kind === "event" ? "Начало" : "Срок"}
                <Input type="datetime-local" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)} />
              </label>
            )}
            {isEnabled("projects") && (projects?.length ?? 0) > 0 ? (
              <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
                Проект
                <Select value={projectDraft} onChange={(e) => setProjectDraft(e.target.value)}>
                  <option value="">Без проекта</option>
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="subtle" size="sm" onClick={() => setPending(null)}>
                Отмена
              </Button>
              <Button type="button" size="sm" disabled={process.isPending} onClick={() => void confirmProcess()}>
                Создать
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить запись?"
        description={
          pendingDelete
            ? `«${pendingDelete.title}» исчезнет из инбокса. Уже созданные задачи, заметки и события останутся.`
            : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </PanelShell>
  );
}
