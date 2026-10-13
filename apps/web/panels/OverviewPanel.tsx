"use client";

import { useCreateTask, useCreateTransaction, useMyOverview, useSession } from "@orion/core-react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PanelBody,
  PanelHeader,
  PanelShell,
  Select,
  Skeleton,
  useToast
} from "@orion/ui";
import { Globe2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { describeError } from "../lib/error-message";
import { formatMoney, shortDateTime } from "../lib/format";
import { openEntity } from "../lib/panel-bus";
import { requestWorkspaceSwitch } from "../lib/unsaved-drafts";
import { useActiveWorkspace } from "../lib/use-active-workspace";

/**
 * U08 "Личный межпространственный обзор" (24-CONNECTED-CORE-BACKLOG.md).
 *
 * Everything here is drawn from `GET /me/overview` (OverviewService, API
 * side) — a read-only aggregation over workspaces the user is already a
 * member of. It grants no new access (23-UNIVERSAL-CONNECTED-CORE.md
 * "Межпространственные данные: отдельный этап"): every task/account shown
 * was already visible one-by-one in its own workspace's Tasks/Finance
 * panel; this just collects them in one place with the source workspace
 * always labeled (done-criterion "источник каждой записи видим").
 *
 * Both quick-capture forms show their target workspace before submission.
 * The current workspace is preferred when eligible; the user can change it
 * explicitly. The expense form prefers a workspace with an account.
 */
export function OverviewPanel(): React.ReactElement {
  const { user } = useSession();
  const { workspace: activeWorkspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { data, isLoading, isError, error, refetch } = useMyOverview(Boolean(user));
  const { toast } = useToast();

  const tasksByWorkspace = useMemo(() => {
    const groups = new Map<string, { workspaceName: string; tasks: NonNullable<typeof data>["tasks"] }>();
    for (const task of data?.tasks ?? []) {
      const group = groups.get(task.workspaceId) ?? { workspaceName: task.workspaceName, tasks: [] };
      group.tasks.push(task);
      groups.set(task.workspaceId, group);
    }
    return [...groups.entries()];
  }, [data]);

  const taskWorkspaces = (data?.workspaces ?? []).filter((w) => w.tasksEnabled);
  const financeWorkspaces = (data?.workspaces ?? []).filter((w) => w.financeEnabled);

  const [captureWsId, setCaptureWsId] = useState("");
  const [captureTitle, setCaptureTitle] = useState("");
  useEffect(() => {
    if (workspaceLoading || captureWsId || taskWorkspaces.length === 0) return;
    setCaptureWsId(taskWorkspaces.find((w) => w.id === activeWorkspace?.id)?.id ?? taskWorkspaces[0].id);
  }, [workspaceLoading, activeWorkspace?.id, captureWsId, taskWorkspaces]);
  const createTask = useCreateTask(captureWsId || undefined);

  async function submitCapture(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = captureTitle.trim();
    if (!title || !captureWsId) return;
    try {
      await createTask.mutateAsync({ title, description: "", priority: "normal" });
      setCaptureTitle("");
      toast({ title: "Задача добавлена", tone: "success" });
    } catch (err) {
      toast({ title: "Не удалось сохранить", description: describeError(err), tone: "danger" });
    }
  }

  const [expenseWsId, setExpenseWsId] = useState("");
  useEffect(() => {
    if (workspaceLoading || expenseWsId || financeWorkspaces.length === 0) return;
    const withAccounts = financeWorkspaces.filter((w) => data?.accounts.some((a) => a.workspaceId === w.id));
    setExpenseWsId(withAccounts.find((w) => w.id === activeWorkspace?.id)?.id ?? withAccounts[0]?.id ?? financeWorkspaces[0].id);
  }, [workspaceLoading, activeWorkspace?.id, expenseWsId, financeWorkspaces, data?.accounts]);
  // Accounts for the currently picked workspace only — ORION has no
  // read-only-account concept (workspace membership is the only access
  // level on Account), so every account belonging to a member workspace is
  // one the caller can also spend from; see OverviewService's doc comment.
  const expenseAccounts = (data?.accounts ?? []).filter((a) => a.workspaceId === expenseWsId);
  const [expenseAccountId, setExpenseAccountId] = useState("");
  useEffect(() => {
    if (expenseAccounts.length > 0 && !expenseAccounts.some((a) => a.id === expenseAccountId)) {
      setExpenseAccountId(expenseAccounts[0].id);
    } else if (expenseAccounts.length === 0) {
      setExpenseAccountId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseWsId, data]);
  const [expenseAmount, setExpenseAmount] = useState("");
  const createTransaction = useCreateTransaction(expenseWsId || undefined);

  async function submitExpense(event: FormEvent): Promise<void> {
    event.preventDefault();
    const rub = Number(expenseAmount.replace(",", "."));
    if (!expenseAccountId || !Number.isFinite(rub) || rub <= 0) return;
    try {
      await createTransaction.mutateAsync({
        accountId: expenseAccountId,
        type: "expense",
        note: "",
        tags: [],
        occurredAt: new Date().toISOString(),
        lines: [{ amount: Math.round(rub * 100) }]
      });
      setExpenseAmount("");
      toast({ title: "Расход добавлен", tone: "success" });
    } catch (err) {
      toast({ title: "Не удалось сохранить", description: describeError(err), tone: "danger" });
    }
  }

  function openTask(workspaceId: string, taskId: string): void {
    // Explicit, user-triggered switch (a click), not a silent fallback —
    // same pattern U04's window model expects for cross-workspace navigation.
    requestWorkspaceSwitch(workspaceId);
    openEntity("task", taskId);
  }

  return (
    <PanelShell>
      <PanelHeader icon={Globe2} title="Обзор" subtitle="Мои задачи и счета из всех пространств" />
      <PanelBody className="space-y-6 [container-type:inline-size]">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={Globe2}
            tone="danger"
            title="Не удалось загрузить обзор"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        ) : (
          <>
            <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-3">
              <h2 className="text-title text-foreground">Быстрая задача</h2>
              <form onSubmit={submitCapture} className="flex flex-col gap-2 [@container(min-width:576px)]:flex-row">
                <Select
                  value={captureWsId}
                  onChange={(e) => setCaptureWsId(e.target.value)}
                  aria-label="Пространство для новой задачи"
                  className="[@container(min-width:576px)]:w-48"
                >
                  {taskWorkspaces.length === 0 ? <option value="">Нет доступных пространств</option> : null}
                  {taskWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
                <Input
                  value={captureTitle}
                  onChange={(e) => setCaptureTitle(e.target.value)}
                  placeholder="Что сделать?"
                  aria-label="Заголовок задачи"
                  disabled={!captureWsId}
                />
                <Button type="submit" size="sm" disabled={!captureWsId || !captureTitle.trim() || createTask.isPending}>
                  Добавить
                </Button>
              </form>
            </section>

            {tasksByWorkspace.length === 0 ? (
              <EmptyState icon={Globe2} title="Нет открытых задач, назначенных вам" />
            ) : (
              <div className="space-y-4">
                {tasksByWorkspace.map(([workspaceId, group]) => (
                  <section key={workspaceId} className="rounded-2xl border border-border bg-card/60 p-3">
                    <h2 className="mb-2 flex items-center gap-2 text-title text-foreground">
                      <Badge tone="neutral">{group.workspaceName}</Badge>
                      <span className="text-micro text-subtle-foreground">{group.tasks.length}</span>
                    </h2>
                    <ul>
                      {group.tasks.map((task) => (
                        <li key={task.id}>
                          <button
                            type="button"
                            onClick={() => openTask(workspaceId, task.id)}
                            className="flex w-full items-center gap-2 rounded-lg px-1 py-row text-left hover:bg-white/5"
                          >
                            <span className="min-w-0 flex-1 truncate text-body text-foreground">{task.title}</span>
                            {task.dueAt ? (
                              <span className="shrink-0 text-micro text-subtle-foreground">{shortDateTime(task.dueAt)}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {(data?.balancesByCurrency.length ?? 0) > 0 ? (
              <section className="rounded-2xl border border-border bg-card/60 p-3">
                <h2 className="mb-2 flex items-center gap-2 text-title text-foreground">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  Все счета
                </h2>
                <div className="space-y-0.5">
                  {data?.balancesByCurrency.map(([currency, total]) => (
                    <p key={currency} className="font-mono text-title tabular-nums text-foreground">
                      {formatMoney(total, currency)}
                    </p>
                  ))}
                </div>
                <ul className="mt-2 space-y-1">
                  {data?.accounts.map((account) => (
                    <li key={account.id} className="flex items-center justify-between gap-2 text-body">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {account.workspaceName} · {account.name}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-foreground">
                        {formatMoney(account.balance, account.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {financeWorkspaces.length > 0 ? (
              <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-3">
                <h2 className="text-title text-foreground">Быстрый расход</h2>
                <form onSubmit={submitExpense} className="flex flex-col gap-2 [@container(min-width:576px)]:flex-row">
                  <Select
                    value={expenseWsId}
                    onChange={(e) => setExpenseWsId(e.target.value)}
                    aria-label="Пространство расхода"
                    className="[@container(min-width:576px)]:w-36"
                  >
                    {financeWorkspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={expenseAccountId}
                    onChange={(e) => setExpenseAccountId(e.target.value)}
                    aria-label="Счёт списания"
                    className="[@container(min-width:576px)]:w-40"
                    disabled={expenseAccounts.length === 0}
                  >
                    {expenseAccounts.length === 0 ? <option value="">Нет счетов</option> : null}
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="Сумма"
                    aria-label="Сумма расхода"
                    inputMode="decimal"
                    disabled={!expenseAccountId}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!expenseAccountId || !expenseAmount.trim() || createTransaction.isPending}
                  >
                    Списать
                  </Button>
                </form>
              </section>
            ) : null}
          </>
        )}
      </PanelBody>
    </PanelShell>
  );
}
