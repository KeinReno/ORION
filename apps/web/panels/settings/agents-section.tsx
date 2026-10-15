"use client";

import { useAgentTokens, useCreateAgentToken, useRevokeAgentToken, useRevokeAllAgentTokens, useUpdateAgentToken } from "@orion/core-react";
import { AGENT_MODES, AGENT_MODE_LABEL, effectiveAgentPermissions, describeAgentPermissions, AGENT_PERMISSION_MODULE_LABEL, AGENT_PERMISSION_OP_LABEL, type AgentMode, type CreatedAgentToken } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, Input, Select, Skeleton, useToast } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { AgentConnectWizard } from "./agent-connect-wizard";
import { AgentPolicyFields, defaultPolicy, policyIsEmpty, policyToInput, type PolicyDraft } from "./agent-permissions";
import { AgentJournal } from "./agents-journal";
import { AgentProposals } from "./agents-proposals";

/** A token with no expiry is allowed, but it is a standing key: the list warns about it. */
const NO_EXPIRY = "none";

/**
 * ORION AI Bridge (ADR-0007): tokens that let an external AI (Claude, Cursor, a script)
 * work in this workspace through `/ai/v1` or the MCP server. A token acts with YOUR
 * rights, only for the ticked permissions, and every call lands in the log below.
 */
export function AgentsSettings(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const tokens = useAgentTokens(workspaceId);
  const update = useUpdateAgentToken(workspaceId);
  const revokeAll = useRevokeAllAgentTokens(workspaceId);
  const create = useCreateAgentToken(workspaceId);
  const revoke = useRevokeAgentToken(workspaceId);

  const [name, setName] = useState("");
  const [policy, setPolicy] = useState<PolicyDraft>(defaultPolicy);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [days, setDays] = useState("30");
  const [issued, setIssued] = useState<CreatedAgentToken | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const created = await create.mutateAsync({ name, ...policyToInput(policy), expiresInDays: days === NO_EXPIRY ? null : Number(days) });
      setIssued(created);
      setName("");
    } catch (error) {
      toast({ title: "Не удалось выпустить токен", description: describeError(error), tone: "danger" });
    }
  }

  async function copySecret(secret: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      toast({ title: "Скопировано", tone: "success" });
    } catch {
      toast({ title: "Не удалось скопировать — выделите токен вручную", tone: "danger" });
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-label text-muted-foreground">
        Токен даёт внешнему ИИ доступ к этому пространству от вашего имени и только в рамках выбранных разрешений. Удалять данные агент не
        может. Отозвать токен можно в любой момент. Проще всего подключить программу мастером ниже.
      </p>

      <AgentConnectWizard workspaceId={workspaceId} />

      <AgentProposals workspaceId={workspaceId} />

      {issued ? (
        <Card className="space-y-2 border-warning/40 bg-warning/10 p-4">
          <p className="text-label font-medium">Токен «{issued.name}» создан. Скопируйте его сейчас — позже он не будет показан.</p>
          <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">{issued.secret}</code>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void copySecret(issued.secret)}>
              Скопировать
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              Готово
            </Button>
          </div>
        </Card>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Название (кто это)</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude на ноутбуке" required maxLength={80} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Срок</span>
            <Select value={days} onChange={(event) => setDays(event.target.value)} className="w-auto">
              <option value="7">7 дней</option>
              <option value="30">30 дней</option>
              <option value="90">90 дней</option>
              <option value="365">1 год</option>
              <option value={NO_EXPIRY}>Без срока (не рекомендуется)</option>
            </Select>
          </label>
        </div>
        <AgentPolicyFields workspaceId={workspaceId} draft={policy} onChange={setPolicy} />
        <Button type="submit" size="sm" disabled={create.isPending || !name.trim() || policyIsEmpty(policy)}>
          Выпустить токен
        </Button>
      </form>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-label font-medium">Мои токены</h3>
          {(tokens.data ?? []).some((t) => t.revokedAt === null) ? (
            <Button size="sm" variant="outline" className="ml-auto" disabled={revokeAll.isPending} onClick={() => setConfirmRevokeAll(true)}>
              Отозвать все токены
            </Button>
          ) : null}
        </div>
        {tokens.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (tokens.data ?? []).length === 0 ? (
          <p className="text-label text-muted-foreground">Токенов пока нет.</p>
        ) : (
          <ul className="space-y-2">
            {(tokens.data ?? []).map((token) => {
              const expired = token.expiresAt !== null && new Date(token.expiresAt).getTime() <= Date.now();
              const inactive = token.revokedAt !== null || expired;
              return (
                <li key={token.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <span className="font-medium">{token.name}</span>
                  <code className="text-2xs text-muted-foreground">{token.prefix}…</code>
                  {token.revokedAt ? <Badge>отозван</Badge> : expired ? <Badge>истёк</Badge> : null}
                  {!inactive && token.expiresAt === null ? <Badge tone="warning">без срока</Badge> : null}
                  {inactive ? (
                    <Badge>{AGENT_MODE_LABEL[token.mode]}</Badge>
                  ) : (
                    <Select
                      aria-label="Режим токена"
                      value={token.mode}
                      onChange={(e) =>
                        update.mutate(
                          { tokenId: token.id, input: { mode: e.target.value as AgentMode } },
                          { onError: (error) => toast({ title: "Не удалось сменить режим", description: describeError(error), tone: "danger" }) }
                        )
                      }
                      className="w-auto"
                    >
                      {AGENT_MODES.map((mode) => (
                        <option key={mode} value={mode}>{AGENT_MODE_LABEL[mode]}</option>
                      ))}
                    </Select>
                  )}
                  <span className="text-2xs text-muted-foreground">
                    {describeAgentPermissions(effectiveAgentPermissions(token.scopes, token.permissions), AGENT_PERMISSION_MODULE_LABEL, AGENT_PERMISSION_OP_LABEL)}
                    {token.allowedProjectIds.length > 0 ? ` · проектов: ${token.allowedProjectIds.length}` : ""}
                    {token.writeLimitPerHour ? ` · до ${token.writeLimitPerHour} записей/час` : ""}
                    {token.forbidden.length > 0 ? ` · запрет: ${token.forbidden.join(", ")}` : ""}
                  </span>
                  <span className="ml-auto text-2xs text-muted-foreground">
                    {token.lastUsedAt ? `последняя активность ${shortDateTime(token.lastUsedAt)}` : "не использовался"}
                  </span>
                  {inactive ? null : (
                    <Button size="sm" variant="ghost" onClick={() => setPendingRevoke(token.id)}>
                      Отозвать
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AgentJournal workspaceId={workspaceId} />

      <ConfirmDialog
        open={confirmRevokeAll}
        title="Отозвать все токены?"
        confirmLabel="Отозвать"
        description="Все ваши агенты сразу потеряют доступ к этому пространству. Выпустить новые токены можно в любой момент."
        onConfirm={() => {
          setConfirmRevokeAll(false);
          revokeAll.mutate(undefined, {
            onSuccess: (count) => toast({ title: `Отозвано токенов: ${count}`, tone: "success" }),
            onError: () => toast({ title: "Не удалось отозвать токены", tone: "danger" })
          });
        }}
        onCancel={() => setConfirmRevokeAll(false)}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Отозвать токен?"
        confirmLabel="Отозвать"
        description="Агент с этим токеном сразу потеряет доступ."
        onConfirm={() => {
          const id = pendingRevoke;
          setPendingRevoke(null);
          if (id) revoke.mutate(id, { onError: () => toast({ title: "Не удалось отозвать токен", tone: "danger" }) });
        }}
        onCancel={() => setPendingRevoke(null)}
      />
    </div>
  );
}
