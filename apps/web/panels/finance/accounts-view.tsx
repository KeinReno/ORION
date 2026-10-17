"use client";

import {
  useCreateAccount,
  useDeleteAccount,
  useAccounts,
  useReconcileAccount,
  useUpdateAccount
} from "@orion/core-react";
import { ACCOUNT_CONTEXT_LABEL, type Account } from "@orion/shared-types";
import {
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  SegmentedControl,
  Skeleton,
  useToast
} from "@orion/ui";
import { ArchiveRestore, Archive, MoreHorizontal, Paperclip, Pencil, Plus, Scale, Trash2, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/error-message";
import { showResourcesFor } from "../../lib/resource-context-store";
import { formatMoney, parseMoneyInput } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { ACCOUNT_KIND_LABEL, AccountForm, type AccountFormValues } from "./account-form";

export function AccountsView(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: accounts, isLoading } = useAccounts(workspace?.id, includeArchived);
  const createAccount = useCreateAccount(workspace?.id);
  const updateAccount = useUpdateAccount(workspace?.id);
  const deleteAccount = useDeleteAccount(workspace?.id);
  const reconcileAccount = useReconcileAccount(workspace?.id);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [reconciling, setReconciling] = useState<Account | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  async function create(values: AccountFormValues): Promise<void> {
    try {
      await createAccount.mutateAsync(values);
      setCreating(false);
      toast({ title: "Счёт создан", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать счёт", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function save(accountId: string, values: AccountFormValues): Promise<void> {
    try {
      await updateAccount.mutateAsync({ accountId, input: { name: values.name, kind: values.kind, context: values.context, visibility: values.visibility, currency: values.currency } });
      setEditing(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить счёт", description: describeAuthError(error), tone: "danger" });
    }
  }

  function toggleArchived(account: Account): void {
    updateAccount.mutate(
      { accountId: account.id, input: { archivedAt: account.archivedAt ? null : new Date().toISOString() } },
      { onSuccess: () => toast({ title: account.archivedAt ? "Счёт восстановлен" : "Счёт отправлен в архив", tone: "default" }) }
    );
  }

  function confirmDelete(): void {
    const account = pendingDelete;
    if (!account) return;
    setPendingDelete(null);
    deleteAccount.mutate(account.id, { onSuccess: () => toast({ title: "Счёт удалён", tone: "default" }) });
  }

  async function confirmReconcile(actualBalance: number): Promise<void> {
    const account = reconciling;
    if (!account) return;
    const diff = actualBalance - account.balance;
    try {
      await reconcileAccount.mutateAsync({ accountId: account.id, actualBalance });
      setReconciling(null);
      toast({
        title: diff === 0 ? "Баланс совпал" : `Скорректировано на ${formatMoney(Math.abs(diff), account.currency)}`,
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось сверить баланс", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          value={includeArchived ? "all" : "active"}
          onChange={(v) => setIncludeArchived(v === "all")}
          options={[
            { value: "active", label: "Активные" },
            { value: "all", label: "Все, включая архив" }
          ]}
        />
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Новый счёт
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:896px)]:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : accounts && accounts.length > 0 ? (
        <div className="grid gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:896px)]:grid-cols-3">
          {accounts.map((account) => (
            <Card key={account.id} elevate className={`flex flex-col gap-2 ${account.archivedAt ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{account.name}</p>
                  <p className="text-2xs text-subtle-foreground">
                    {ACCOUNT_KIND_LABEL[account.kind]}
                    {account.visibility === "private" ? " · 🔒 только вы" : ""}
                    {account.context !== "personal" ? ` · ${ACCOUNT_CONTEXT_LABEL[account.context]}` : ""}
                    {account.currency !== "RUB" ? ` · ${account.currency}` : ""}
                    {account.archivedAt ? " · в архиве" : ""}
                  </p>
                </div>
                <DropdownMenu
                  trigger={({ toggle }) => (
                    <IconButton label="Действия" size="sm" onClick={toggle}>
                      <MoreHorizontal className="h-4 w-4" />
                    </IconButton>
                  )}
                  items={[
                    { label: "Файлы и связи", icon: Paperclip, onSelect: () => showResourcesFor("finance", { type: "account", id: account.id, title: account.name }) },
                    { label: "Изменить", icon: Pencil, onSelect: () => setEditing(account) },
                    { label: "Сверить баланс", icon: Scale, onSelect: () => setReconciling(account) },
                    account.archivedAt
                      ? { label: "Восстановить", icon: ArchiveRestore, onSelect: () => toggleArchived(account) }
                      : { label: "Архивировать", icon: Archive, onSelect: () => toggleArchived(account) },
                    { label: "Удалить", icon: Trash2, tone: "danger", onSelect: () => setPendingDelete(account) }
                  ]}
                />
              </div>
              <p className={`font-mono text-xl font-semibold tabular-nums ${account.balance < 0 ? "text-destructive" : "text-foreground"}`}>
                {formatMoney(account.balance, account.currency)}
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Wallet}
          title="Счетов пока нет"
          description="Заведите хотя бы один — наличные или карту — чтобы привязывать к нему операции."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Новый счёт
            </Button>
          }
        />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый счёт" size="sm">
        <AccountForm busy={createAccount.isPending} submitLabel="Создать" onCancel={() => setCreating(false)} onSubmit={create} />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Счёт" size="sm">
        {editing ? (
          <AccountForm
            key={editing.id}
            initial={editing}
            busy={updateAccount.isPending}
            submitLabel="Сохранить"
            onCancel={() => setEditing(null)}
            onSubmit={(values) => save(editing.id, values)}
          />
        ) : null}
      </Modal>

      <Modal open={reconciling !== null} onClose={() => setReconciling(null)} title="Сверка баланса" size="sm">
        {reconciling ? (
          <ReconcileForm
            account={reconciling}
            busy={reconcileAccount.isPending}
            onCancel={() => setReconciling(null)}
            onSubmit={confirmReconcile}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить счёт?"
        description={
          pendingDelete
            ? `«${pendingDelete.name}» — вместе со счётом удалятся все операции по нему. Действие необратимо.`
            : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/**
 * The simple reconciliation flow (v0.13, see docs/HISTORY.md): no per-
 * transaction cleared/uncleared state, just "what does the bank actually
 * say" → the backend creates one corrective transaction if it disagrees
 * with the computed balance.
 */
function ReconcileForm({
  account,
  busy,
  onCancel,
  onSubmit
}: {
  account: Account;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (actualBalance: number) => void | Promise<void>;
}): React.ReactElement {
  const [value, setValue] = useState((account.balance / 100).toString());

  function submit(event: FormEvent): void {
    event.preventDefault();
    const actualBalance = parseMoneyInput(value);
    if (actualBalance === null) return;
    void onSubmit(actualBalance);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-xs text-subtle-foreground">
        Расчётный баланс: <span className="text-foreground">{formatMoney(account.balance, account.currency)}</span>. Введите
        фактический — при расхождении добавится одна корректирующая операция.
      </p>
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Фактический баланс, {account.currency}
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          Сверить
        </Button>
      </div>
    </form>
  );
}
