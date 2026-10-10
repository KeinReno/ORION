"use client";

import {
  useCalendarConnections,
  useCreateCalendarConnection,
  useDeleteCalendarConnection,
  useSyncCalendarConnection,
  useUpdateCalendarConnection
} from "@orion/core-react";
import type { CalendarConnection, CalendarConnectionInput } from "@orion/shared-types";
import { Badge, Button, ConfirmDialog, IconButton, Input, Modal, Popover, Select, Skeleton, cx, useToast } from "@orion/ui";
import { Check, Link2, Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { relativeTime, shortDateTime } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

const KIND_LABEL: Record<CalendarConnection["kind"], string> = {
  ics: "ICS-ссылка",
  caldav: "CalDAV",
  google: "Google"
};

const EMPTY_FORM: CalendarConnectionInput = {
  name: "",
  kind: "ics",
  url: "",
  username: "",
  password: "",
  color: null,
  enabled: true
};

/**
 * Inbound ICS/CalDAV subscriptions plus the outbound read-only feed URL,
 * parked in a toolbar popover so they don't sit under the grid.
 */
export function CalendarConnectionsButton({
  feedUrl,
  onRotateFeed
}: {
  feedUrl?: string;
  onRotateFeed: () => void;
}): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { data: connections, isLoading } = useCalendarConnections(workspace?.id);
  const createConnection = useCreateCalendarConnection(workspace?.id);
  const updateConnection = useUpdateCalendarConnection(workspace?.id);
  const syncConnection = useSyncCalendarConnection(workspace?.id);
  const deleteConnection = useDeleteCalendarConnection(workspace?.id);
  const { toast } = useToast();

  const [editing, setEditing] = useState<CalendarConnection | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [values, setValues] = useState<CalendarConnectionInput>(EMPTY_FORM);
  const [pendingDelete, setPendingDelete] = useState<CalendarConnection | null>(null);

  function startCreate(): void {
    setEditing(null);
    setValues(EMPTY_FORM);
    setFormOpen(true);
  }

  function startEdit(connection: CalendarConnection): void {
    setEditing(connection);
    setValues({
      name: connection.name,
      kind: connection.kind,
      url: connection.url,
      username: connection.username,
      // The stored password is encrypted server-side and never returned — an
      // empty field means "keep what's there" (see SyncPanel for the same idiom).
      password: "",
      color: connection.color,
      enabled: connection.enabled
    });
    setFormOpen(true);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!values.name.trim() || !values.url.trim()) return;
    if (editing) {
      await updateConnection.mutateAsync({ id: editing.id, input: values });
      toast({ title: "Подписка обновлена", tone: "success" });
    } else {
      await createConnection.mutateAsync(values);
      toast({ title: "Подписка добавлена", tone: "success" });
    }
    setFormOpen(false);
  }

  function runSync(connection: CalendarConnection): void {
    syncConnection.mutate(connection.id, {
      onSuccess: (result) =>
        toast({
          title: result.imported > 0 ? `Импортировано событий: ${result.imported}` : "Новых событий нет",
          tone: "success"
        }),
      onError: () => toast({ title: "Не удалось прочитать календарь", tone: "danger" })
    });
  }

  function confirmDelete(): void {
    const connection = pendingDelete;
    if (!connection) return;
    setPendingDelete(null);
    deleteConnection.mutate(connection.id, { onSuccess: () => toast({ title: "Подписка удалена" }) });
  }

  return (
    <>
      <Popover
        align="end"
        width={360}
        trigger={({ toggle, ref, open }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label="Ссылка"
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-micro font-medium text-muted-foreground hover:text-foreground"
          >
            <Link2 className="h-3.5 w-3.5" />
            Ссылка
            {connections && connections.length > 0 ? (
              <span className="text-subtle-foreground">{connections.length}</span>
            ) : null}
          </button>
        )}
      >
        {() => (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-label font-medium text-foreground">Подписка (только чтение)</p>
              <p className="mb-2 text-micro text-subtle-foreground">
                Добавьте эту ссылку в календарь телефона — события и задачи ORION появятся там. Правки — только в ORION.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded bg-black/30 px-2 py-1 text-micro text-foreground/80">
                  {feedUrl ?? "…"}
                </code>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={!feedUrl}
                  onClick={() => {
                    if (feedUrl) void navigator.clipboard.writeText(feedUrl);
                    toast({ title: "Скопировано", tone: "success" });
                  }}
                >
                  Копировать
                </Button>
                <Button size="sm" variant="subtle" onClick={onRotateFeed}>
                  Перевыпустить
                </Button>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="mb-1 text-label font-medium text-foreground">Внешние календари</p>
              <p className="mb-2 text-micro text-subtle-foreground">
                Подписка на чужой календарь (ICS/CalDAV) — события импортируются только для чтения и не уезжают обратно.
              </p>

              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : connections && connections.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {connections.map((connection) => (
                    <li key={connection.id} className="flex items-start gap-2 rounded-2xl border border-border bg-card p-2.5">
                      <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-subtle-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{connection.name}</span>
                          <Badge tone={connection.enabled ? "success" : "neutral"}>{KIND_LABEL[connection.kind]}</Badge>
                          {!connection.enabled ? <span className="text-micro text-subtle-foreground">выключена</span> : null}
                        </div>
                        <p className="truncate text-micro text-subtle-foreground">{connection.url}</p>
                        <p className={cx("text-micro", connection.lastError ? "text-destructive" : "text-subtle-foreground")}>
                          {connection.lastError
                            ? `Ошибка: ${connection.lastError}`
                            : connection.lastSyncAt
                              ? `Синхронизировано ${relativeTime(connection.lastSyncAt)}`
                              : "Ещё не синхронизировалось"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton
                          label="Синхронизировать"
                          size="sm"
                          onClick={() => runSync(connection)}
                          status={
                            syncConnection.isPending && syncConnection.variables === connection.id
                              ? "pending"
                              : syncConnection.isSuccess && syncConnection.variables === connection.id
                                ? "success"
                                : syncConnection.isError && syncConnection.variables === connection.id
                                  ? "error"
                                  : "idle"
                          }
                        >
                          <Check className="h-4 w-4" />
                        </IconButton>
                        <IconButton label="Изменить" size="sm" onClick={() => startEdit(connection)}>
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton label="Удалить" size="sm" onClick={() => setPendingDelete(connection)}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-micro text-subtle-foreground">
                  Подписок пока нет
                </p>
              )}

              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={startCreate}>
                  Добавить подписку
                </Button>
              </div>
            </div>
          </div>
        )}
      </Popover>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Подписка" : "Новая подписка"} size="sm">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            placeholder="Название"
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            required
            autoFocus
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-micro text-subtle-foreground">
              Тип
              <Select
                value={values.kind}
                onChange={(e) => setValues({ ...values, kind: e.target.value as CalendarConnection["kind"] })}
              >
                <option value="ics">ICS-ссылка</option>
                <option value="caldav">CalDAV</option>
                <option value="google">Google</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-micro text-subtle-foreground">
              Состояние
              <Select
                value={values.enabled ? "on" : "off"}
                onChange={(e) => setValues({ ...values, enabled: e.target.value === "on" })}
              >
                <option value="on">Включена</option>
                <option value="off">Выключена</option>
              </Select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-micro text-subtle-foreground">
            Адрес календаря
            <Input
              type="url"
              placeholder="https://example.com/calendar.ics"
              value={values.url}
              onChange={(e) => setValues({ ...values, url: e.target.value })}
              required
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-micro text-subtle-foreground">
              Логин (если нужен)
              <Input value={values.username} onChange={(e) => setValues({ ...values, username: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-micro text-subtle-foreground">
              Пароль
              <Input
                type="password"
                placeholder={editing ? "оставьте пустым, чтобы не менять" : ""}
                value={values.password}
                onChange={(e) => setValues({ ...values, password: e.target.value })}
              />
            </label>
          </div>
          {editing?.lastSyncAt ? (
            <p className="text-micro text-subtle-foreground">Последняя синхронизация: {shortDateTime(editing.lastSyncAt)}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="subtle" size="sm" onClick={() => setFormOpen(false)}>
              Отмена
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createConnection.isPending || updateConnection.isPending || !values.name.trim() || !values.url.trim()}
            >
              {editing ? "Сохранить" : "Добавить"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить подписку?"
        description={
          pendingDelete
            ? `«${pendingDelete.name}» — импортированные из неё события останутся в календаре, но перестанут обновляться.`
            : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
