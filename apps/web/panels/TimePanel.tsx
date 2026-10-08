"use client";

import { ApiError } from "@orion/core";
import {
  useCreateTimeEntry,
  useDeleteTimeEntry,
  useProjects,
  useRunningTimer,
  useStartTimer,
  useTasks,
  useTimeEntries,
  useTimeEntriesSummary,
  useUpdateTimeEntry
} from "@orion/core-react";
import {
  entryMinutes,
  formatDuration,
  summarizeByAuthorship,
  timeCostMinor,
  timeEntryDay,
  type TimeEntry
} from "@orion/shared-types";
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Modal,
  PanelBody,
  PanelHeader,
  PanelSection,
  PanelShell,
  Skeleton,
  StatCard,
  useResizeWidth,
  useToast
} from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Play, Plus, Timer, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoney, toDatetimeLocal } from "../lib/format";
import { describeError } from "../lib/error-message";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { EntryForm, type EntryFormDraft, type EntryFormValues } from "./time/entry-form";
import { dayLabel, groupEntriesByDay, summariseEntries, timeRange } from "./time/summary";
import { TimerWidget } from "./time/timer-widget";
import { useNowTick } from "./time/use-now";

/** Default manual entry: the last hour, so the common "я только что закончил" needs two clicks. */
function lastHourDraft(): EntryFormDraft {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  return {
    taskId: "",
    projectId: "",
    note: "",
    startedAt: toDatetimeLocal(start.toISOString()),
    endedAt: toDatetimeLocal(end.toISOString())
  };
}

function EntryRow({
  entry,
  now,
  title,
  projectName,
  costLabel,
  resumeDisabled,
  onEdit,
  onResume,
  onDelete
}: {
  entry: TimeEntry;
  now: Date;
  title: string;
  projectName: string | null;
  costLabel: { text: string; title?: string; partial?: boolean } | null;
  resumeDisabled: boolean;
  onEdit: () => void;
  onResume: () => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-border bg-card/60 px-3 py-card-row">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-micro tabular-nums text-muted-foreground">{timeRange(entry)}</span>
          {entry.running ? <Badge tone="accent">идёт</Badge> : null}
        </div>
        <p className="mt-1 truncate text-body text-foreground">{title}</p>
        {projectName ? <Badge className="mt-1">{projectName}</Badge> : null}
        {entry.note ? <p className="mt-1 line-clamp-2 text-label text-muted-foreground">{entry.note}</p> : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {formatDuration(entryMinutes(entry, now))}
        </span>
        {costLabel ? (
          <span className="font-mono text-micro tabular-nums text-muted-foreground" title={costLabel.title}>
            {costLabel.text}
            {costLabel.partial ? <span title="частично оценено">*</span> : null}
          </span>
        ) : null}
      </div>

      <DropdownMenu
        trigger={({ open, toggle }) => (
          <IconButton label="Действия с записью" size="sm" aria-expanded={open} onClick={toggle}>
            <MoreVertical className="h-4 w-4" />
          </IconButton>
        )}
        items={[
          { label: "Изменить", icon: Pencil, onSelect: onEdit },
          { label: "Запустить заново", icon: Play, onSelect: onResume, disabled: resumeDisabled },
          "separator",
          { label: "Удалить", icon: Trash2, tone: "danger", onSelect: onDelete }
        ]}
      />
    </div>
  );
}

/**
 * Учёт времени (v0.18): a start/stop widget, totals, and the log grouped by day.
 *
 * The whole panel reads from two caches — `["time", workspaceId]` for the log
 * and `["time-running", workspaceId]` for whether a timer is live — and every
 * mutation invalidates both (see `use-time.ts`).
 */
export function TimePanel(): React.ReactElement {
  const [layoutRef, layoutWidth] = useResizeWidth<HTMLDivElement>();
  const wideLayout = layoutWidth >= 920;
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const workspaceId = workspace?.id;
  const tasksOn = isEnabled("tasks");
  const projectsOn = isEnabled("projects");

  const entriesQuery = useTimeEntries(workspaceId);
  const runningQuery = useRunningTimer(workspaceId);
  const now0 = useMemo(() => new Date(), []);
  // UTC day boundary — same definition `timeEntryDay`/the grouping use, so
  // this headline figure can't disagree with "Сегодня" in the day groups.
  const todayStartIso = useMemo(() => `${timeEntryDay({ startedAt: now0.toISOString(), endedAt: null })}T00:00:00.000Z`, [now0]);
  const weekAgoIso = useMemo(() => new Date(now0.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), [now0]);
  // Exact totals from a server-side aggregate — never a sum of whatever pages
  // `useTimeEntries` happens to have loaded (S15: that used to silently
  // undercount past the old 500-row cap).
  const todaySummaryQuery = useTimeEntriesSummary(workspaceId, { from: todayStartIso });
  const weekSummaryQuery = useTimeEntriesSummary(workspaceId, { from: weekAgoIso });
  const totalSummaryQuery = useTimeEntriesSummary(workspaceId);
  const { data: tasks } = useTasks(tasksOn ? workspaceId : undefined);
  const { data: projects, isSuccess: projectsLoaded } = useProjects(projectsOn ? workspaceId : undefined);
  const { data: archivedProjects, isSuccess: archivedProjectsLoaded } = useProjects(
    projectsOn ? workspaceId : undefined,
    true
  );

  const createEntry = useCreateTimeEntry(workspaceId);
  const updateEntry = useUpdateTimeEntry(workspaceId);
  const deleteEntry = useDeleteTimeEntry(workspaceId);
  const startTimer = useStartTimer(workspaceId);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const running = runningQuery.data ?? null;
  const now = useNowTick(running !== null);

  const taskTitles = useMemo(() => new Map((tasks ?? []).map((task) => [task.id, task.title])), [tasks]);
  const allProjects = useMemo(
    () => [...(projects ?? []), ...(archivedProjects ?? [])],
    [projects, archivedProjects]
  );
  const projectNames = useMemo(() => new Map(allProjects.map((project) => [project.id, project.name])), [allProjects]);
  // Пока список проектов не загружен, ставок мы не знаем вообще: до этого
  // момента панель не показывает ни денег, ни «ставка не задана».
  const ratesKnown = projectsOn ? projectsLoaded && archivedProjectsLoaded : true;

  const list = entriesQuery.entries;
  const summary = useMemo(() => summariseEntries(list, allProjects, now), [list, allProjects, now]);
  const groups = useMemo(() => groupEntriesByDay(list, now), [list, now]);
  const costs = ratesKnown ? summary.costs : [];
  const nothingPriced = ratesKnown && summary.costs.length === 0 && summary.total > 0;
  // Разрез «мои / команда / автор неизвестен» — по уже загруженной странице
  // (как и «По проектам» ниже), а не отдельный серверный агрегат: то же
  // допущение, что и у project totals, отдельного эндпоинта для него нет.
  const authorship = useMemo(() => summarizeByAuthorship(list), [list]);
  // Соло-пространство почти всегда даёт team=0/unknown=0 — тогда разрез не
  // несёт информации и просто дублирует «Всего», поэтому его прячем.
  const showAuthorship = authorship.teamMinutes > 0 || authorship.unknownAuthorMinutes > 0;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimeEntry | null>(null);

  function entryTitle(entry: TimeEntry): string {
    const title = entry.taskId ? taskTitles.get(entry.taskId) : undefined;
    const project = entry.projectId ? projectNames.get(entry.projectId) : undefined;
    return title ?? project ?? "Без задачи";
  }

  function entryCost(entry: TimeEntry): { text: string; title?: string; partial?: boolean } | null {
    if (!ratesKnown) return null;
    const project = entry.projectId ? allProjects.find((item) => item.id === entry.projectId) : undefined;
    const cost = timeCostMinor(entryMinutes(entry, now), project?.hourlyRate ?? null);
    if (cost === null) return { text: "—", title: "Ставка не указана" };
    return { text: formatMoney(cost, project?.currency ?? "RUB") };
  }

  function reportConflict(): void {
    void queryClient.invalidateQueries({ queryKey: ["time-running", workspaceId] });
    toast({
      title: running ? `Уже идёт по «${entryTitle(running)}»` : "Уже идёт",
      tone: "default"
    });
  }

  /**
   * "Запустить заново" starts a *new* running entry with the same task/project/note —
   * it never re-opens the old one (`endedAt: null` on a finished row would both
   * lose its duration and collide with the one-running-timer index).
   */
  async function resume(entry: TimeEntry): Promise<void> {
    try {
      await startTimer.mutateAsync({ taskId: entry.taskId, projectId: entry.projectId, note: entry.note });
      toast({ title: "Таймер запущен", description: "Новая запись с той же задачей и проектом", tone: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        reportConflict();
        return;
      }
      toast({ title: "Не удалось запустить таймер", tone: "danger" });
    }
  }

  async function createManual(values: EntryFormValues): Promise<void> {
    try {
      await createEntry.mutateAsync(values);
      setCreating(false);
      toast({ title: "Запись добавлена", tone: "success" });
    } catch (error) {
      toast({
        title: "Не удалось добавить запись",
        description: error instanceof ApiError ? error.message : undefined,
        tone: "danger"
      });
    }
  }

  async function saveEdit(entryId: string, values: EntryFormValues): Promise<void> {
    try {
      await updateEntry.mutateAsync({ entryId, input: values });
      setEditing(null);
      toast({ title: "Запись обновлена", tone: "success" });
    } catch (error) {
      toast({
        title: "Не удалось сохранить запись",
        description: error instanceof ApiError ? error.message : undefined,
        tone: "danger"
      });
    }
  }

  function confirmDelete(): void {
    const entry = pendingDelete;
    if (!entry) return;
    setPendingDelete(null);
    deleteEntry.mutate(entry.id, {
      onSuccess: () => toast({ title: "Запись удалена", tone: "default" }),
      onError: () => toast({ title: "Не удалось удалить запись", tone: "danger" })
    });
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={Timer}
        title="Учёт времени"
        subtitle="Запускайте таймер или вносите записи вручную"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={workspaceId === undefined}>
            <Plus className="h-4 w-4" /> Добавить запись
          </Button>
        }
      />

      <PanelBody measure="wide">
        <div ref={layoutRef}>
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Timer}
              title="Нет рабочего пространства"
              description="Учёт времени живёт внутри пространства — создайте его или войдите заново."
            />
          )
        ) : (
          <div className={wideLayout ? "grid grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] gap-6" : "mx-auto max-w-2xl space-y-6"}>
            <div className="min-w-0 space-y-6">
            <TimerWidget
              key={running?.id ?? "idle"}
              workspaceId={workspaceId}
              running={running}
              tasks={tasksOn ? (tasks ?? []) : undefined}
              projects={projectsOn ? (projects ?? []) : undefined}
            />

            <PanelSection title="Итоги">
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  label="Сегодня"
                  value={todaySummaryQuery.data ? formatDuration(todaySummaryQuery.data.minutes) : "…"}
                />
                <StatCard
                  label="7 дней"
                  value={weekSummaryQuery.data ? formatDuration(weekSummaryQuery.data.minutes) : "…"}
                />
                <StatCard
                  label="Всего"
                  value={totalSummaryQuery.data ? formatDuration(totalSummaryQuery.data.minutes) : "…"}
                />
              </div>

              {showAuthorship ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-subtle-foreground">
                  <span>
                    Мои:{" "}
                    <span className="font-mono tabular-nums text-foreground">
                      {formatDuration(authorship.mineMinutes)}
                    </span>
                  </span>
                  <span>
                    Команда:{" "}
                    <span className="font-mono tabular-nums text-foreground">
                      {formatDuration(authorship.teamMinutes)}
                    </span>
                  </span>
                  {authorship.unknownAuthorMinutes > 0 ? (
                    <span>
                      Автор неизвестен:{" "}
                      <span className="font-mono tabular-nums text-foreground">
                        {formatDuration(authorship.unknownAuthorMinutes)}
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : null}

              {costs.length > 0 ? (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {costs.map((cost) => (
                    <span key={cost.currency} className="flex items-baseline gap-1.5">
                      <span className="text-2xs text-subtle-foreground">Стоимость времени:</span>
                      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                        {formatMoney(cost.costMinor, cost.currency)}
                        {summary.unratedMinutes > 0 ? (
                          <span className="text-label text-subtle-foreground" title="частично оценено">
                            *
                          </span>
                        ) : null}
                      </span>
                    </span>
                  ))}
                  {summary.unratedMinutes > 0 ? (
                    <span className="text-micro text-subtle-foreground">
                      частично оценено: {formatDuration(summary.ratedMinutes)} из{" "}
                      {formatDuration(summary.total)}
                    </span>
                  ) : null}
                </div>
              ) : nothingPriced ? (
                <p className="text-2xs text-subtle-foreground">
                  {projectsOn
                    ? "Стоимость не посчитана: у проектов со временем не задана ставка."
                    : "Стоимость не посчитана: модуль «Проекты» выключен."}
                </p>
              ) : null}

              {summary.projectTotals.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-2xs text-subtle-foreground">По проектам</p>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {summary.projectTotals.map((item) => (
                      <li key={item.projectId} className="flex items-center justify-between gap-3 px-3 py-row">
                        <span className="min-w-0 truncate text-body text-foreground">
                          {projectNames.get(item.projectId) ?? "Проект"}
                          {item.costMinor !== null && summary.unratedMinutes > 0 ? (
                            <span className="text-subtle-foreground" title="частично оценено">
                              *
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-baseline gap-2">
                          <span className="font-mono text-micro tabular-nums text-muted-foreground">
                            {formatDuration(item.minutes)}
                          </span>
                          {!ratesKnown ? null : item.costMinor !== null ? (
                            <span className="font-mono text-sm tabular-nums text-foreground">
                              {formatMoney(item.costMinor, item.currency)}
                            </span>
                          ) : (
                            <span className="font-mono text-micro tabular-nums text-subtle-foreground" title="Ставка не указана">
                              —
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </PanelSection>
            </div>

            <div className="min-w-0">
            <PanelSection title="Записи">
              {entriesQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : entriesQuery.isError ? (
                <EmptyState
                  icon={TriangleAlert}
                  tone="danger"
                  title="Не удалось загрузить записи"
                  description={describeError(entriesQuery.error)}
                  action={
                    <Button size="sm" variant="outline" onClick={() => void entriesQuery.refetch()}>
                      Повторить
                    </Button>
                  }
                />
              ) : groups.length === 0 ? (
                <EmptyState
                  icon={Timer}
                  title="Записей пока нет"
                  description="Запустите таймер сверху или внесите запись вручную — например, за вчера."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                      <Plus className="h-4 w-4" /> Добавить запись
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-4">
                  {groups.map((group) => (
                    <div key={group.day} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-micro font-medium text-subtle-foreground">
                          {dayLabel(group.day, now)}
                        </h3>
                        <span className="font-mono text-label tabular-nums text-foreground">
                          {formatDuration(group.minutes)}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {group.entries.map((entry) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            now={now}
                            title={entryTitle(entry)}
                            projectName={entry.projectId ? projectNames.get(entry.projectId) ?? null : null}
                            costLabel={entryCost(entry)}
                            resumeDisabled={running !== null}
                            onEdit={() => setEditing(entry)}
                            onResume={() => void resume(entry)}
                            onDelete={() => setPendingDelete(entry)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  {entriesQuery.hasNextPage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={entriesQuery.isFetchingNextPage}
                      onClick={() => void entriesQuery.fetchNextPage()}
                    >
                      {entriesQuery.isFetchingNextPage ? "Загрузка…" : "Показать ещё"}
                    </Button>
                  ) : null}
                </div>
              )}
            </PanelSection>
            </div>
          </div>
        )}
        </div>
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новая запись" size="sm">
        <EntryForm
          tasks={tasksOn ? (tasks ?? []) : undefined}
          projects={projectsOn ? (projects ?? []) : undefined}
          initial={lastHourDraft()}
          busy={createEntry.isPending}
          submitLabel="Добавить"
          onCancel={() => setCreating(false)}
          onSubmit={createManual}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Изменить запись" size="sm">
        {editing ? (
          <EntryForm
            key={editing.id}
            tasks={tasksOn ? (tasks ?? []) : undefined}
            projects={projectsOn ? (projects ?? []) : undefined}
            initial={{
              taskId: editing.taskId ?? "",
              projectId: editing.projectId ?? "",
              note: editing.note,
              startedAt: toDatetimeLocal(editing.startedAt),
              // A running entry has no end yet and the form needs one: it opens
              // at "now", and saving is what stops the timer at that minute.
              endedAt: toDatetimeLocal(editing.endedAt ?? new Date().toISOString())
            }}
            busy={updateEntry.isPending}
            submitLabel="Сохранить"
            submitHint={editing.running ? "Сохранение остановит идущий таймер на указанном времени." : undefined}
            onCancel={() => setEditing(null)}
            onSubmit={(values) => saveEdit(editing.id, values)}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить запись?"
        description={pendingDelete ? `Запись за ${timeRange(pendingDelete)} исчезнет безвозвратно.` : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </PanelShell>
  );
}
