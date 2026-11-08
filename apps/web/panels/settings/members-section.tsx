"use client";

import {
  useCreateWorkspaceInvite,
  useRemoveWorkspaceMember,
  useRevokeWorkspaceInvite,
  useSetWorkspaceMemberRole,
  useWorkspaceInvites,
  useSession,
  useWorkspaceMembers
} from "@orion/core-react";
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, Input, Skeleton, useToast } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { AccountAvatar } from "../../components/account-avatar";
import { ChoiceSelect } from "../../components/choice-select";
import { ExportWorkspaceCard } from "../../components/workspace-transfer";
import { describeAuthError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

const STATUS_LABEL: Record<WorkspaceInvite["status"], string> = {
  pending: "Ожидает",
  accepted: "Принято",
  revoked: "Отозвано",
  expired: "Истекло"
};

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Владелец",
  lead: "Тимлид",
  member: "Участник"
};

/** What each role adds, for the invite form; data access is the same for every role today (G12). */
const ROLE_HINT: Record<WorkspaceRole, string> = {
  member: "Работает со всеми данными пространства.",
  lead: "То же, плюс приглашает и убирает участников.",
  owner: "Всё, плюс роли, модули, плагины и удаление пространства."
};

export function MembersSettings(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { user } = useSession();
  const members = useWorkspaceMembers(workspace?.id);
  const invites = useWorkspaceInvites(workspace?.id);
  const removeMember = useRemoveWorkspaceMember(workspace?.id);
  const setRole = useSetWorkspaceMemberRole(workspace?.id);
  const revokeInvite = useRevokeWorkspaceInvite(workspace?.id);
  const createInvite = useCreateWorkspaceInvite(workspace?.id);
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "lead">("member");
  const [pendingRemove, setPendingRemove] = useState<WorkspaceMember | null>(null);
  const isOwner = workspace?.role === "owner";
  const canManageMembers = isOwner || workspace?.role === "lead";

  async function onSetRole(member: WorkspaceMember, role: WorkspaceRole): Promise<void> {
    try {
      await setRole.mutateAsync({ memberId: member.id, input: { role } });
      toast({ title: `${member.name}: роль «${ROLE_LABEL[role]}»`, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось изменить роль", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onInvite(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const result = await createInvite.mutateAsync({ email, role: inviteRole });
      setEmail("");
      void navigator.clipboard.writeText(result.acceptUrl);
      toast({
        title: `Приглашение для ${result.email} создано`,
        description: `Ссылка скопирована в буфер обмена. Если ссылка не открывается на другом устройстве, дайте код: ${result.code}`,
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось создать приглашение", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onRemove(): Promise<void> {
    const member = pendingRemove;
    if (!member) return;
    setPendingRemove(null);
    try {
      await removeMember.mutateAsync(member.id);
      toast({ title: `${member.name} исключён из пространства`, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось убрать участника", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onRevoke(invite: WorkspaceInvite): Promise<void> {
    try {
      await revokeInvite.mutateAsync(invite.id);
      toast({ title: "Приглашение отозвано", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось отозвать приглашение", description: describeAuthError(error), tone: "danger" });
    }
  }

  const pendingInvites = invites.data?.filter((invite) => invite.status === "pending") ?? [];

  return (
    <div className="space-y-6">
      {canManageMembers && workspace?.isPersonal ? (
        <p className="rounded-lg border border-border bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
          Это ваше личное пространство — оно создаётся для одного человека и не предлагается как общее. Чтобы работать вместе,
          создайте общее пространство (например, «Дом») на экране «Пространства» и приглашайте туда.
        </p>
      ) : null}

      {canManageMembers && !workspace?.isPersonal ? (
        <section data-setting="invite" className="space-y-2" aria-label="Пригласить участника">
          <header className="px-1">
            <h3 className="text-sm font-medium text-foreground">Пригласить</h3>
            <p className="text-2xs text-subtle-foreground">
              Писем ORION не отправляет: ссылка копируется в буфер обмена — передайте её сами. Человек входит или регистрируется
              с тем же email и принимает приглашение.
            </p>
          </header>
          <Card>
            <form className="flex flex-wrap items-end gap-3" onSubmit={onInvite}>
              <label className="min-w-[200px] flex-1 space-y-1">
                <span className="text-xs text-muted-foreground">Email</span>
                <Input type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Роль</span>
                <ChoiceSelect
                  className="w-36"
                  label="Роль"
                  value={inviteRole}
                  options={isOwner ? [{ value: "member", label: ROLE_LABEL.member }, { value: "lead", label: ROLE_LABEL.lead }] : [{ value: "member", label: ROLE_LABEL.member }]}
                  onChange={setInviteRole}
                />
              </label>
              <Button
                type="submit"
                status={createInvite.isPending ? "pending" : createInvite.isSuccess ? "success" : createInvite.isError ? "error" : "idle"}
              >
                Пригласить
              </Button>
            </form>
            <dl className="mt-3 grid gap-1 border-t border-border pt-3 text-2xs text-subtle-foreground [@container(min-width:576px)]:grid-cols-3">
              {(["member", "lead", "owner"] as const).map((role) => (
                <div key={role}>
                  <dt className="font-medium text-muted-foreground">{ROLE_LABEL[role]}</dt>
                  <dd>{ROLE_HINT[role]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </section>
      ) : null}

      <section data-setting="members" className="space-y-2" aria-label="Участники">
        <header className="flex items-end justify-between gap-2 px-1">
          <div>
            <h3 className="text-sm font-medium text-foreground">Участники</h3>
            {!canManageMembers ? (
              <p className="text-2xs text-subtle-foreground">Приглашать и убирать участников может владелец или тимлид пространства.</p>
            ) : null}
          </div>
          {members.data ? <span className="text-2xs text-subtle-foreground">{members.data.length}</span> : null}
        </header>
        {members.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            {(members.data ?? []).map((member) => (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <AccountAvatar userId={member.userId} name={member.name} hasAvatar={member.hasAvatar} size={32} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="truncate">{member.name}</span>
                      {member.userId === user?.id ? <span className="text-2xs font-normal text-subtle-foreground">вы</span> : null}
                    </p>
                    <p className="mt-0.5 truncate text-2xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && member.role !== "owner" ? (
                    <ChoiceSelect
                      className="w-32"
                      label={`Роль: ${member.name}`}
                      value={member.role === "lead" ? "lead" : "member"}
                      disabled={setRole.isPending}
                      options={[{ value: "member", label: ROLE_LABEL.member }, { value: "lead", label: ROLE_LABEL.lead }]}
                      onChange={(role) => void onSetRole(member, role)}
                    />
                  ) : (
                    <Badge tone={member.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[member.role]}</Badge>
                  )}
                  {canManageMembers && member.role !== "owner" ? (
                    <Button size="sm" variant="ghost" disabled={removeMember.isPending} onClick={() => setPendingRemove(member)}>
                      Убрать
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {canManageMembers && pendingInvites.length > 0 ? (
        <section className="space-y-2" aria-label="Ожидающие приглашения">
          <h3 className="px-1 text-sm font-medium text-foreground">Ожидают ответа</h3>
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{invite.email}</span>
                    <Badge tone="neutral">{STATUS_LABEL[invite.status]}</Badge>
                  </p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {ROLE_LABEL[invite.role]} · истекает {shortDateTime(invite.expiresAt)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled={revokeInvite.isPending} onClick={() => void onRevoke(invite)}>
                  Отозвать
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isOwner && workspace ? <ExportWorkspaceCard workspaceId={workspace.id} workspaceName={workspace.name} /> : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        title={pendingRemove ? `Убрать «${pendingRemove.name}»?` : "Убрать участника"}
        description="Участник потеряет доступ к этому рабочему пространству."
        confirmLabel="Убрать"
        danger
        onConfirm={() => void onRemove()}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
