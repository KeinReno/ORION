"use client";

import { useDeleteWorkspace, useUpdateWorkspace } from "@orion/core-react";
import { Button, Card, ConfirmDialog, Input, useToast } from "@orion/ui";
import { useEffect, useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/error-message";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

export function WorkspaceSettings(): React.ReactElement {
  const { workspace, workspaces } = useActiveWorkspace();
  const updateWorkspace = useUpdateWorkspace(workspace?.id);
  const deleteWorkspace = useDeleteWorkspace();
  const { toast } = useToast();

  const [name, setName] = useState(workspace?.name ?? "");
  const [confirmText, setConfirmText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isOwner = workspace?.role === "owner";
  const isOnlyWorkspace = workspaces.length <= 1;

  // Reseed the form whenever the active workspace changes (switcher, or after
  // this workspace is renamed and the query cache refetches).
  useEffect(() => {
    setName(workspace?.name ?? "");
  }, [workspace?.id, workspace?.name]);

  async function saveName(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!workspace || trimmed === workspace.name) return;
    try {
      await updateWorkspace.mutateAsync({ name: trimmed });
      toast({ title: "Пространство переименовано", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось переименовать пространство", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onDelete(): Promise<void> {
    if (!workspace) return;
    setConfirmOpen(false);
    setConfirmText("");
    try {
      await deleteWorkspace.mutateAsync(workspace.id);
      toast({ title: `Пространство «${workspace.name}» удалено`, tone: "default" });
    } catch (error) {
      toast({ title: "Не удалось удалить пространство", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (!workspace) return <Card className="text-sm text-muted-foreground">Загрузка…</Card>;

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={saveName}>
          <label className="min-w-[240px] flex-1 space-y-1">
            <span className="text-xs text-muted-foreground">Название пространства</span>
            <Input required maxLength={80} value={name} disabled={!isOwner} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button type="submit" disabled={!isOwner || updateWorkspace.isPending || name.trim() === workspace.name}>
            Сохранить
          </Button>
        </form>
        {!isOwner ? (
          <p className="text-2xs text-subtle-foreground">Переименовать пространство может только владелец.</p>
        ) : null}
      </Card>

      <Card className="space-y-3 border-destructive/30">
        <div>
          <p className="text-sm font-medium text-foreground">Удалить пространство</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Безвозвратно удаляет «{workspace.name}» вместе со всеми задачами, заметками, событиями, документами,
            финансами и остальными данными — включая файлы на диске. Отменить нельзя.
          </p>
        </div>
        {!isOwner ? (
          <p className="text-2xs text-subtle-foreground">Удалить пространство может только владелец.</p>
        ) : isOnlyWorkspace ? (
          <p className="text-2xs text-subtle-foreground">
            Это единственное ваше пространство — сначала создайте другое, потом можно будет удалить это.
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            disabled={deleteWorkspace.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            Удалить пространство
          </Button>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={`Удалить «${workspace.name}»?`}
        description={
          <div className="space-y-2">
            <p>Это действие нельзя отменить. Чтобы подтвердить, введите название пространства ниже.</p>
            <Input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={workspace.name}
            />
          </div>
        }
        confirmLabel="Удалить безвозвратно"
        danger
        confirmDisabled={confirmText !== workspace.name}
        onConfirm={() => void onDelete()}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmText("");
        }}
      />
    </div>
  );
}
