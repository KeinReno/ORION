"use client";

import {
  useCreateWorkspaceInvite,
  useRemoveWorkspaceMember,
  useRevokeWorkspaceInvite,
  useSetWorkspaceMemberRole,
  useWorkspaceInvites,
  useWorkspaceMembers
} from "@orion/core-react";
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, Input, Select, Skeleton, useToast } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { AccountAvatar } from "../../components/account-avatar";
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

export function MembersSettings(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
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
      {!canManageMembers ? (
        <p className="text-xs text-muted-foreground">Приглашать и убирать участников может владелец или тимлид пространства.</p>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">Участники</h3>
        {members.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="space-y-2">
            {(members.data ?? []).map((member) => (
              <Card key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <AccountAvatar userId={member.userId} name={member.name} hasAvatar={member.hasAvatar} size={32} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {member.name}
                      <Badge tone={member.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[member.role]}</Badge>
                    </p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && member.role !== "owner" ? (
                    <Select
                      className="w-32"
                      value={member.role}
                      disabled={setRole.isPending}
                      onChange={(e) => void onSetRole(member, e.target.value as WorkspaceRole)}
                    >
                      <option value="member">{ROLE_LABEL.member}</option>
                      <option value="lead">{ROLE_LABEL.lead}</option>
                    </Select>
                  ) : null}
                  {canManageMembers && member.role !== "owner" ? (
                    <Button size="sm" variant="outline" disabled={removeMember.isPending} onClick={() => setPendingRemove(member)}>
                      Убрать
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {canManageMembers && workspace?.isPersonal ? (
        <p className="rounded-lg border border-border bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
          Это ваше личное пространство — оно создаётся для одного человека и не предлагается как общее. Чтобы работать вместе,
          создайте общее пространство (например, «Дом») на экране «Пространства» и приглашайте туда.
        </p>
      ) : null}

      {canManageMembers && !workspace?.isPersonal ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">Пригласить по email</h3>
          <Card>
            <form className="flex flex-wrap items-end gap-3" onSubmit={onInvite}>
              <label className="flex-1 space-y-1">
                <span className="text-xs text-muted-foreground">Email</span>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Роль</span>
                <Select className="w-36" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "member" | "lead")}>
                  <option value="member">{ROLE_LABEL.member}</option>
                  {isOwner ? <option value="lead">{ROLE_LABEL.lead}</option> : null}
                </Select>
              </label>
              <Button
                type="submit"
                status={createInvite.isPending ? "pending" : createInvite.isSuccess ? "success" : createInvite.isError ? "error" : "idle"}
              >
                Пригласить
              </Button>
            </form>
            <p className="mt-2 text-2xs text-subtle-foreground">
              Отправки писем пока нет — ссылка копируется в буфер обмена, передайте её вручную. Человек сначала создаёт свой аккаунт
              (тот же email), затем принимает приглашение. Роль «Тимлид» может выдать только владелец.
            </p>
          </Card>
        </section>
      ) : null}

      {canManageMembers && pendingInvites.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">Ожидающие приглашения</h3>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <Card key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {invite.email}
                    <Badge tone="neutral">{STATUS_LABEL[invite.status]}</Badge>
                  </p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {ROLE_LABEL[invite.role]} · истекает {shortDateTime(invite.expiresAt)}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={revokeInvite.isPending} onClick={() => void onRevoke(invite)}>
                  Отозвать
                </Button>
              </Card>
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
