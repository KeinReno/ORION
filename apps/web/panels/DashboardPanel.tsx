"use client";

import { ApiError } from "@orion/core";
import {
  useAccounts,
  useBudgets,
  useCaptureInboxItem,
  useCreateNote,
  useCreateTask,
  useEvents,
  useHabits,
  useInbox,
  useNotes,
  useRunningTimer,
  useSession,
  useStartTimer,
  useStopTimer,
  useTasks,
  useToggleHabit,
  useUpdateTask
} from "@orion/core-react";
import type { Habit, Task } from "@orion/shared-types";
import {
  entryMinutes,
  formatDuration,
  localDayDueAt,
  localDayRange,
  partitionOpenTasks,
  partitionWeekReview,
  quickCaptureHint,
  quickCapturePlaceholder,
  resolveQuickCapture
} from "@orion/shared-types";
import {
  Badge,
  Button,
  CheckToggle,
  ConfirmDialog,
  EmptyState,
  Input,
  LiveDot,
  PanelBody,
  PanelHeader,
  PanelShell,
  Skeleton,
  cx,
  useToast
} from "@orion/ui";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Inbox,
  LayoutDashboard,
  Sparkles,
  StickyNote,
  Target,
  Timer,
  Wallet
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { OnboardingCard } from "../components/onboarding-card";
import { describeError } from "../lib/error-message";
import { eventLocalStart, eventShortStart, formatMoney, relativeTime, shortDateTime, sumByCurrency } from "../lib/format";
import { focusNote, focusTask, openPanel } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useDayKey, useLocalNow } from "../lib/use-day-boundary";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { useNowTick } from "./time/use-now";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export function DashboardPanel(): React.ReactElement {
  const { user } = useSession();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const wsId = workspace?.id;
  const tasksOn = isEnabled("tasks");
  const notesOn = isEnabled("notes");
  const financeOn = isEnabled("finance");
  const calendarOn = isEnabled("calendar");
  const habitsOn = isEnabled("habits");
  const timeOn = isEnabled("time");
  // `localNow`/`todayKey` only change at a real local-day boundary or a
  // visibility/focus wake (S10, see use-day-boundary.ts) — not on every
  // render — so "Сегодня"'s ranges/groups stop being frozen at whatever day
  // the panel happened to mount on (evening-to-midnight tab, laptop sleep)
  // while still not forcing a refetch on every render: `tasks`/`habits`
  // etc. are only re-partitioned client-side, not re-fetched, when the day
  // key changes.
  const localNow = useLocalNow();
  const todayKey = useDayKey();
  const dayRange = useMemo(() => localDayRange(localNow), [localNow]);
  const eventRange = useMemo(() => {
    const end = new Date(dayRange.to);
    end.setDate(end.getDate() + 13);
    return { from: dayRange.from, to: end.toISOString() };
  }, [dayRange.from, dayRange.to]);
  const headerNow = localNow;
  // Weekend-only: a daily week-review block becomes noise by Wednesday.
  const weekReviewDay = headerNow.getDay() === 0 || headerNow.getDay() === 5;

  const {
    data: notes,
    isLoading: notesLoading,
    isError: notesError,
    error: notesQueryError,
    refetch: refetchNotes
  } = useNotes(notesOn ? wsId : undefined);
  const {
    data: tasks,
    isLoading: tasksLoading,
    isError: tasksError,
    error: tasksQueryError,
    refetch: refetchTasks
  } = useTasks(tasksOn ? wsId : undefined);
  const { data: accounts } = useAccounts(financeOn ? wsId : undefined);
  const { data: budgets } = useBudgets(financeOn ? wsId : undefined, todayKey.slice(0, 7));
  const { data: events } = useEvents(calendarOn ? wsId : undefined, calendarOn ? eventRange : undefined);
  const { data: habits } = useHabits(habitsOn ? wsId : undefined, false, todayKey);
  const { data: inboxQueue } = useInbox(wsId, false);
  const { data: running } = useRunningTimer(timeOn ? wsId : undefined);
  const createTask = useCreateTask(tasksOn ? wsId : undefined);
  const createNote = useCreateNote(notesOn ? wsId : undefined);
  const captureInbox = useCaptureInboxItem(wsId);
  const updateTask = useUpdateTask(tasksOn ? wsId : undefined);
  const startTimer = useStartTimer(timeOn ? wsId : undefined);
  const stopTimer = useStopTimer(timeOn ? wsId : undefined);
  const toggleHabit = useToggleHabit(habitsOn ? wsId : undefined);
  const { toast } = useToast();
  const tick = useNowTick(Boolean(running));

  const [capture, setCapture] = useState("");
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const [timerSwitch, setTimerSwitch] = useState<Task | null>(null);

  const parts = useMemo(() => partitionOpenTasks(tasks ?? [], localNow), [tasks, localNow]);
  const overdueIds = useMemo(() => new Set(parts.overdue.map((task) => task.id)), [parts.overdue]);
  const focusShown = parts.focus.filter((task) => !overdueIds.has(task.id));
  const focusIds = new Set(focusShown.map((task) => task.id));
  const todayRest = parts.today.filter((task) => !focusIds.has(task.id) && !overdueIds.has(task.id));
  const dueHabits = (habits ?? []).filter((habit) => habit.dueToday);
  // Real total (S15), not `items.length` — the server caps the response at 250 rows.
  const inboxCount = inboxQueue?.totalCount ?? 0;
  const week = useMemo(() => partitionWeekReview(tasks ?? [], localNow), [tasks, localNow]);
  const weekVisible =
    tasksOn &&
    weekReviewDay &&
    (week.completed.length > 0 || week.remaining.length > 0 || week.overdueBeforeWeek.length > 0);

  const todayEvents = useMemo(
    () =>
      (events ?? []).filter(
        (event) =>
          eventLocalStart(event).toISOString() < dayRange.to &&
          // The API window is by instant; yesterday's all-day event (UTC
          // 00:00–24:00) still overlaps the start of a Moscow day by 3 hours.
          (!event.allDay || eventLocalStart({ startAt: event.endAt, allDay: true }).toISOString() > dayRange.from)
      ),
    [events, dayRange.from, dayRange.to]
  );
  const nearbyEvents = useMemo(
    () => (events ?? []).filter((event) => eventLocalStart(event).toISOString() >= dayRange.to),
    [events, dayRange.to]
  );

  const recentNotes = useMemo(
    () =>
      [...(notes ?? [])]
        .sort((a, b) => Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 4),
    [notes]
  );

  const financeStats = useMemo(() => {
    // Accounts aren't all one currency (Account.currency, v0.14) — summing
    // raw balances across a USD and a EUR account into one number is not a
    // real amount of anything (see `sumByCurrency` in lib/format.ts, S16).
    // This used to be a naive `reduce((sum, a) => sum + a.balance, 0)`
    // printed with `formatMoney(totalBalance)`, which silently defaults to
    // ₽ — a confident-looking but wrong figure for any multi-currency
    // workspace, same bug class `FinanceSummaryRow` already guards against.
    const balancesByCurrency = sumByCurrency(accounts ?? [], (a) => a.currency, (a) => a.balance);
    const overBudgetCount = (budgets ?? []).filter((b) => b.spent > b.limitAmount).length;
    return { balancesByCurrency, hasAccounts: (accounts?.length ?? 0) > 0, budgetCount: budgets?.length ?? 0, overBudgetCount };
  }, [accounts, budgets]);

  const loading = (notesOn && notesLoading) || (tasksOn && tasksLoading);
  // Block-level, not panel-level (04-UX «Реестр состояний»: «Ошибка
  // календаря не скрывает задачи»): a tasks fetch failure used to blank the
  // whole panel — capture, alerts, habits, events, finance — behind one
  // full-page EmptyState even though only the task-derived sections were
  // actually unavailable. `tasksBlockError`/`notesBlockError` instead gate
  // just their own section below; everything else keeps rendering off
  // whatever data DID load.
  const tasksBlockError = tasksOn && tasksError;
  const notesBlockError = notesOn && notesError;
  const hasAlerts = parts.overdue.length > 0 || Boolean(running) || inboxCount > 0;
  const showFocus = (tasksOn && focusShown.length > 0) || (habitsOn && dueHabits.length > 0);
  const showToday = todayEvents.length > 0 || todayRest.length > 0;
  const showNearest = nearbyEvents.length > 0 || (tasksOn && parts.upcoming.length > 0);
  const showNotes = notesOn && recentNotes.length > 0;
  const showSecondary = showToday || showNearest || weekVisible || financeOn || showNotes;
  const quiet =
    !loading && !tasksBlockError && !notesBlockError && !hasAlerts && !showFocus && !showSecondary;

  const capturePreview = capture.trim()
    ? resolveQuickCapture(capture, { tasks: tasksOn, notes: notesOn })
    : null;
  const captureHintText = capturePreview ? quickCaptureHint(capturePreview) : null;

  async function runCapture(text: string): Promise<void> {
    const resolved = resolveQuickCapture(text, { tasks: tasksOn, notes: notesOn });
    if (resolved.kind === "error") {
      toast({ title: resolved.message, tone: "danger" });
      return;
    }
    try {
      if (resolved.kind === "task") {
        await createTask.mutateAsync({
          title: resolved.title,
          description: "",
          dueAt: resolved.dueToday ? localDayDueAt(new Date()) : null,
          projectTag: resolved.projectTag ?? null,
          priority: "normal"
        });
        toast({ title: "Задача добавлена", tone: "success" });
      } else if (resolved.kind === "note") {
        await createNote.mutateAsync({ title: resolved.title, body: "", tags: [] });
        toast({ title: "Заметка добавлена", tone: "success" });
      } else {
        await captureInbox.mutateAsync({ title: resolved.title, body: "", kind: "inbox" });
        toast({ title: "Добавлено в инбокс", tone: "success" });
      }
      setCapture("");
    } catch (error) {
      toast({
        title: "Не удалось сохранить",
        description: describeError(error),
        tone: "danger",
        action: { label: "Повторить", onClick: () => void runCapture(captureRef.current) }
      });
    }
  }

  async function submitCapture(event: FormEvent): Promise<void> {
    event.preventDefault();
    await runCapture(capture);
  }

  function toggleDone(task: Task): void {
    const next = task.status === "done" ? "todo" : "done";
    updateTask.mutate(
      { taskId: task.id, input: { status: next } },
      {
        onSuccess: () =>
          toast({
            title: next === "done" ? "Готово" : "Вернули в работу",
            tone: "success",
            action: {
              label: "Отменить",
              onClick: () => updateTask.mutate({ taskId: task.id, input: { status: task.status } })
            }
          })
      }
    );
  }

  function onToggleHabit(habit: Habit): void {
    toggleHabit.mutate({ habitId: habit.id, day: todayKey });
  }

  function startFor(task: Task): void {
    if (running?.taskId === task.id) {
      openPanel("time");
      return;
    }
    startTimer.mutate(
      { taskId: task.id, projectId: task.projectId, note: task.title },
      {
        onSuccess: () => toast({ title: "Таймер запущен", description: task.title, tone: "success" }),
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            setTimerSwitch(task);
            return;
          }
          toast({
            title: "Не удалось запустить таймер",
            description: describeError(error),
            tone: "danger"
          });
        }
      }
    );
  }

  async function confirmTimerSwitch(): Promise<void> {
    const task = timerSwitch;
    setTimerSwitch(null);
    if (!task) return;
    try {
      await stopTimer.mutateAsync({});
      await startTimer.mutateAsync({ taskId: task.id, projectId: task.projectId, note: task.title });
      toast({ title: "Таймер запущен", description: task.title, tone: "success" });
    } catch (error) {
      toast({
        title: "Не удалось переключить таймер",
        description: describeError(error),
        tone: "danger"
      });
    }
  }

  const captureBusy = createNote.isPending || createTask.isPending || captureInbox.isPending;
  const runningTitle =
    running?.note?.trim() ||
    (running?.taskId ? tasks?.find((task) => task.id === running.taskId)?.title : undefined) ||
    "другая задача";

  return (
    <PanelShell glow>
      <PanelHeader
        icon={LayoutDashboard}
        title={`${greeting()}, ${user?.name ?? "коллега"}`}
        subtitle={headerNow.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
      />
      <PanelBody className="space-y-6">
        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Capture stays up: OnboardingCard's copy points at the field
                above, and that component is out of scope. With no alerts the
                chip ribbon is what the card replaces (it returns null once dismissed). */}
            <header className="space-y-3">
              <form onSubmit={submitCapture} className="space-y-1.5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="orion-quick-capture"
                    value={capture}
                    onChange={(e) => setCapture(e.target.value)}
                    placeholder={quickCapturePlaceholder({ tasks: tasksOn, notes: notesOn })}
                    aria-label="Быстрый ввод"
                  />
                  <Button type="submit" size="sm" disabled={captureBusy || !capture.trim()} className="shrink-0">
                    Добавить
                  </Button>
                </div>
                {captureHintText ? (
                  <p
                    className={cx(
                      "text-label",
                      capturePreview?.kind === "error" ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {captureHintText}
                  </p>
                ) : null}
              </form>
              {hasAlerts ? (
                <div className="flex flex-wrap gap-2">
                  {parts.overdue.length > 0 ? (
                    <StatusChip tone="danger" onClick={() => openPanel("tasks")}>
                      Просрочено {parts.overdue.length}
                    </StatusChip>
                  ) : null}
                  {running ? (
                    <StatusChip tone="accent" onClick={() => openPanel("time")}>
                      <LiveDot />
                      <span className="truncate">{running.note || "Идёт таймер"}</span>
                      <span className="font-mono tabular-nums">{formatDuration(entryMinutes(running, tick))}</span>
                    </StatusChip>
                  ) : null}
                  {inboxCount > 0 ? (
                    <StatusChip tone="neutral" onClick={() => openPanel("inbox")}>
                      <Inbox className="h-3 w-3" />
                      Инбокс {inboxCount}
                    </StatusChip>
                  ) : null}
                </div>
              ) : (
                <OnboardingCard onCapture={() => document.getElementById("orion-quick-capture")?.focus()} />
              )}
            </header>

            {tasksBlockError ? (
              <EmptyState
                icon={AlertCircle}
                tone="danger"
                title="Не удалось загрузить задачи"
                description={describeError(tasksQueryError)}
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetchTasks()}>
                    Повторить
                  </Button>
                }
              />
            ) : null}
            {notesBlockError ? (
              <EmptyState
                icon={StickyNote}
                tone="danger"
                title="Не удалось загрузить заметки"
                description={describeError(notesQueryError)}
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetchNotes()}>
                    Повторить
                  </Button>
                }
              />
            ) : null}

            {quiet ? (
              <p className="text-body text-muted-foreground">На сегодня ничего срочного — можно начать с быстрого ввода.</p>
            ) : null}

            {showFocus ? (
              <div className="grid gap-6 md:grid-cols-2">
                {tasksOn && focusShown.length > 0 ? (
                  <Section title="Фокус" icon={Sparkles} onOpen={() => openPanel("tasks")}>
                    <ActionList
                      tasks={focusShown}
                      onToggle={toggleDone}
                      withDate
                      busy={updateTask.isPending || startTimer.isPending}
                      onStart={timeOn ? startFor : undefined}
                      runningTaskId={running?.taskId ?? null}
                    />
                  </Section>
                ) : null}
                {habitsOn && dueHabits.length > 0 ? (
                  <Section title="Привычки" icon={Target} onOpen={() => openPanel("habits")}>
                    <ul>
                      {dueHabits.map((habit) => (
                        <li key={habit.id} className="flex items-center gap-2 rounded-lg px-1 py-row">
                          <CheckToggle
                            checked={habit.doneToday}
                            onClick={() => onToggleHabit(habit)}
                            disabled={toggleHabit.isPending}
                            label={
                              habit.doneToday ? `Снять отметку «${habit.name}»` : `Отметить «${habit.name}»`
                            }
                          />
                          <span
                            className={cx(
                              "min-w-0 flex-1 truncate text-body",
                              habit.doneToday && "text-muted-foreground line-through"
                            )}
                          >
                            {habit.name}
                          </span>
                          {habit.streak > 0 ? (
                            <span className="shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">
                              {habit.streak}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}
              </div>
            ) : null}

            {showSecondary ? (
              <div className="grid gap-6 md:grid-cols-2">
                {showToday ? (
                  <Section
                    title="Сегодня"
                    icon={CalendarClock}
                    onOpen={() => openPanel(calendarOn ? "calendar" : "tasks")}
                  >
                    <ul>
                      {todayEvents.map((event) => (
                        <li key={event.id}>
                          <button
                            type="button"
                            onClick={() => openPanel("calendar")}
                            className="flex w-full items-center gap-2 rounded-lg px-1 py-row text-left hover:bg-white/5"
                          >
                            <span className="w-14 shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">
                              {event.allDay ? "весь день" : clock(event.startAt)}
                            </span>
                            <span className="truncate text-body text-foreground">{event.title || "Без названия"}</span>
                          </button>
                        </li>
                      ))}
                      {todayRest.map((task) => (
                        <TaskRow key={task.id} task={task} onToggle={toggleDone} withDate busy={updateTask.isPending} />
                      ))}
                    </ul>
                  </Section>
                ) : null}

                {showNearest ? (
                  <Section
                    title="Ближайшие"
                    icon={ArrowRight}
                    onOpen={() => openPanel(calendarOn && nearbyEvents.length > 0 ? "calendar" : "tasks")}
                  >
                    <ul>
                      {nearbyEvents.map((event) => (
                        <li key={event.id}>
                          <button
                            type="button"
                            onClick={() => openPanel("calendar")}
                            className="flex w-full items-center gap-2 rounded-lg px-1 py-row text-left hover:bg-white/5"
                          >
                            <span className="w-14 shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">
                              {event.allDay ? "весь день" : clock(event.startAt)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-body text-foreground">
                              {event.title || "Без названия"}
                            </span>
                            <span className="shrink-0 text-micro text-subtle-foreground">
                              {eventShortStart(event)}
                            </span>
                          </button>
                        </li>
                      ))}
                      {parts.upcoming.map((task) => (
                        <TaskRow key={task.id} task={task} onToggle={toggleDone} withDate busy={updateTask.isPending} />
                      ))}
                    </ul>
                  </Section>
                ) : null}

                {weekVisible ? (
                  <Section title="Обзор недели" icon={Target} onOpen={() => openPanel("tasks")}>
                    <ul className="space-y-1 text-body">
                      <li className="text-foreground">
                        Закрыто: <span className="font-mono tabular-nums">{week.completed.length}</span>
                      </li>
                      {week.remaining.length > 0 ? (
                        <li className="text-muted-foreground">
                          Со сроком на эту неделю:{" "}
                          <span className="font-mono tabular-nums text-foreground">{week.remaining.length}</span>
                        </li>
                      ) : null}
                      {week.overdueBeforeWeek.length > 0 ? (
                        <li className="text-destructive">
                          С прошлых недель:{" "}
                          <span className="font-mono tabular-nums">{week.overdueBeforeWeek.length}</span>
                        </li>
                      ) : null}
                    </ul>
                  </Section>
                ) : null}

                {financeOn ? (
                  <Section title="Финансы" icon={Wallet} onOpen={() => openPanel("finance")}>
                    {financeStats.hasAccounts ? (
                      <div>
                        {financeStats.balancesByCurrency.map(([currency, total]) => (
                          <p key={currency} className="font-mono text-title tabular-nums text-foreground">
                            {formatMoney(total, currency)}
                          </p>
                        ))}
                        {financeStats.budgetCount > 0 ? (
                          <p
                            className={cx(
                              "mt-1 text-micro",
                              financeStats.overBudgetCount > 0 ? "text-destructive" : "text-muted-foreground"
                            )}
                          >
                            {financeStats.overBudgetCount > 0
                              ? `Превышено бюджетов: ${financeStats.overBudgetCount} из ${financeStats.budgetCount}`
                              : `Бюджеты месяца в норме (${financeStats.budgetCount})`}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-micro text-muted-foreground">Заведите счёт, чтобы видеть баланс здесь.</p>
                    )}
                  </Section>
                ) : null}

                {showNotes ? (
                  <Section title="Недавние заметки" icon={StickyNote} onOpen={() => openPanel("notes")}>
                    <ul>
                      {recentNotes.map((note) => (
                        <li key={note.id}>
                          <button
                            type="button"
                            onClick={() => focusNote(note.id)}
                            className="flex w-full items-baseline justify-between gap-3 rounded-lg px-1 py-row text-left hover:bg-white/5"
                          >
                            <span className="truncate text-body text-foreground">{note.title || "Без заголовка"}</span>
                            <span className="shrink-0 text-micro text-subtle-foreground">{relativeTime(note.updatedAt)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </PanelBody>
      <ConfirmDialog
        open={timerSwitch !== null}
        title={`Сейчас идёт таймер по «${runningTitle}» — переключить на эту?`}
        confirmLabel="Переключить"
        cancelLabel="Отмена"
        danger={false}
        onConfirm={() => void confirmTimerSwitch()}
        onCancel={() => setTimerSwitch(null)}
      />
    </PanelShell>
  );
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function DashboardSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

function StatusChip({
  tone,
  onClick,
  children
}: {
  tone: "danger" | "accent" | "neutral";
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-medium",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "accent" && "border-accent/30 bg-accent/10 text-accent",
        tone === "neutral" && "border-border text-muted-foreground hover:bg-white/[0.03]"
      )}
    >
      {tone === "danger" ? <AlertCircle className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
}

function Section({
  title,
  icon: Icon,
  onOpen,
  className,
  children
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  onOpen?: () => void;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className={cx("min-w-0 rounded-2xl border border-border bg-card/60 p-3", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-title text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h2>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Открыть: ${title}`}
            className="rounded-md p-0.5 text-subtle-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ActionList({
  tasks,
  onToggle,
  withDate,
  busy,
  onStart,
  runningTaskId
}: {
  tasks: Task[];
  onToggle: (task: Task) => void;
  withDate?: boolean;
  busy: boolean;
  onStart?: (task: Task) => void;
  runningTaskId?: string | null;
}): React.ReactElement {
  return (
    <ul>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onToggle={onToggle}
          withDate={withDate}
          busy={busy}
          onStart={onStart}
          running={runningTaskId === task.id}
        />
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  onToggle,
  withDate,
  busy,
  onStart,
  running
}: {
  task: Task;
  onToggle: (task: Task) => void;
  withDate?: boolean;
  busy: boolean;
  onStart?: (task: Task) => void;
  running?: boolean;
}): React.ReactElement {
  const done = task.status === "done";
  return (
    // flex-wrap + a title with a real minimum width: on a phone (or a
    // narrow docked panel) the meta group — project tag, due date, timer —
    // drops under the title instead of squeezing the title to zero width
    // and pushing «Запустить таймер» out of the card.
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-1 py-row hover:bg-white/5">
      <CheckToggle
        checked={done}
        onClick={() => onToggle(task)}
        disabled={busy}
        label={done ? "Вернуть в работу" : `Отметить «${task.title}» выполненной`}
        tone="success"
      />
      <button
        type="button"
        onClick={() => focusTask(task.id)}
        className="min-w-[8rem] flex-1 basis-32 truncate text-left text-body text-foreground"
      >
        {task.title}
      </button>
      <span className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
        {task.projectTag ? <Badge tone="neutral">{task.projectTag}</Badge> : null}
        {withDate && task.dueAt ? (
          <span className="shrink-0 text-micro text-subtle-foreground">{shortDateTime(task.dueAt)}</span>
        ) : null}
        {onStart ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStart(task)}
            aria-label={running ? "Открыть таймер" : `Запустить таймер для «${task.title}»`}
            className={cx(
              "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-label",
              running ? "text-accent" : "text-subtle-foreground hover:text-foreground"
            )}
          >
            <Timer className="h-3.5 w-3.5" />
            {running ? null : <span>Запустить таймер</span>}
          </button>
        ) : null}
      </span>
    </li>
  );
}
