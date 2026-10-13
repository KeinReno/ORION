"use client";

import { useAgentAuditLog, useAgentTokens, useCreateAgentToken, useRevokeAgentToken } from "@orion/core-react";
import { AGENT_SCOPES, AGENT_SCOPE_LABEL, type AgentScope, type CreatedAgentToken } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, Input, Select, Skeleton, useToast } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

const DEFAULT_SCOPES: AgentScope[] = ["tasks:read", "notes:read", "projects:read"];

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
  const audit = useAgentAuditLog(workspaceId);
  const create = useCreateAgentToken(workspaceId);
  const revoke = useRevokeAgentToken(workspaceId);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AgentScope[]>(DEFAULT_SCOPES);
  const [days, setDays] = useState("30");
  const [issued, setIssued] = useState<CreatedAgentToken | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  function toggle(scope: AgentScope): void {
    setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const created = await create.mutateAsync({ name, scopes, expiresInDays: Number(days) });
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
        может. Отозвать токен можно в любой момент. Подключение к Claude/Cursor — через MCP:{" "}
        <code className="rounded bg-muted px-1">node scripts/orion-mcp.mjs</code> с переменной{" "}
        <code className="rounded bg-muted px-1">ORION_AGENT_TOKEN</code>.
      </p>

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
            </Select>
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-xs text-muted-foreground">Разрешения</legend>
          {AGENT_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-1.5 text-label">
              <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggle(scope)} className="accent-accent" />
              {AGENT_SCOPE_LABEL[scope]}
            </label>
          ))}
        </fieldset>
        <Button type="submit" size="sm" disabled={create.isPending || !name.trim() || scopes.length === 0}>
          Выпустить токен
        </Button>
      </form>

      <section className="space-y-2">
        <h3 className="text-label font-medium">Мои токены</h3>
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
                  <span className="text-2xs text-muted-foreground">
                    {token.scopes.map((scope) => AGENT_SCOPE_LABEL[scope]).join(" · ")}
                  </span>
                  <span className="ml-auto text-2xs text-muted-foreground">
                    {token.lastUsedAt ? `использован ${shortDateTime(token.lastUsedAt)}` : "не использовался"}
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

      <section className="space-y-2">
        <h3 className="text-label font-medium">Журнал действий агентов</h3>
        {(audit.data ?? []).length === 0 ? (
          <p className="text-label text-muted-foreground">Агенты пока ничего не делали.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-label">
            {(audit.data ?? []).slice(0, 50).map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-3 px-3 py-1.5">
                <span className="text-muted-foreground">{shortDateTime(entry.createdAt)}</span>
                <span>{entry.tokenName}</span>
                <code>{entry.action}</code>
                {entry.resource ? <code className="text-muted-foreground">{entry.resource}</code> : null}
                <span className={entry.status >= 400 ? "ml-auto text-danger" : "ml-auto text-muted-foreground"}>{entry.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Отозвать токен?"
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
