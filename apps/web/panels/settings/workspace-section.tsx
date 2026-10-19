"use client";

import { useDeleteWorkspace, useUpdateWorkspace } from "@orion/core-react";
import { Button, Card, ConfirmDialog, Input, useToast } from "@orion/ui";
import { useEffect, useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/error-message";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { SaveBar, SettingGroup, SettingRow } from "./setting-row";

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

  const nameChanged = isOwner && name.trim() !== workspace.name;

  return (
    <div className="space-y-6">
      <form id="settings-workspace-form" onSubmit={saveName}>
        <SettingGroup title="Основное" description={isOwner ? undefined : "Менять может только владелец пространства."}>
          <SettingRow anchor="rename" label="Название" description="Видно всем участникам в списке пространств и в меню." changed={nameChanged}>
            <Input
              aria-label="Название пространства"
              required
              maxLength={80}
              className="w-64 max-w-full"
              value={name}
              disabled={!isOwner}
              onChange={(e) => setName(e.target.value)}
            />
          </SettingRow>
          <SettingRow label="Ваша роль">
            <span className="text-label text-muted-foreground">{isOwner ? "Владелец" : workspace.role === "lead" ? "Тимлид" : "Участник"}</span>
          </SettingRow>
        </SettingGroup>
        <SaveBar
          form="settings-workspace-form"
          changedCount={nameChanged ? 1 : 0}
          pending={updateWorkspace.isPending}
          onReset={() => setName(workspace.name)}
        />
      </form>

      <SettingGroup title="Опасная зона">
        <SettingRow
          anchor="delete"
          label="Удалить пространство"
          description={
            <>
              Безвозвратно удаляет «{workspace.name}» со всеми задачами, заметками, событиями, документами, финансами и файлами на
              диске.{" "}
              {!isOwner
                ? "Удалить может только владелец."
                : isOnlyWorkspace
                  ? "Это единственное ваше пространство — сначала создайте другое."
                  : null}
            </>
          }
        >
          {isOwner && !isOnlyWorkspace ? (
            <Button
              type="button"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={deleteWorkspace.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              Удалить…
            </Button>
          ) : null}
        </SettingRow>
      </SettingGroup>

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
