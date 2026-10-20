"use client";

import { useAgentConnection, useAgentTokens, useCreateAgentToken, useInstallAgentClient } from "@orion/core-react";
import {
  AGENT_INSTALL_CLIENTS,
  AGENT_RECOMMENDED_SCOPES,
  AGENT_SCOPES,
  AGENT_SCOPE_LABEL,
  type AgentInstallClient,
  type AgentScope,
  type CreatedAgentToken,
  type InstalledAgentClient
} from "@orion/shared-types";
import { Button, Card, Select, useToast } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { AGENT_CLIENTS, AGENT_CLIENT_LABEL, buildConnectSnippet, checkAgentConnection, type AgentClient, type ConnectionCheck } from "../../lib/agent-connect";
import { describeError } from "../../lib/error-message";
import { relativeTime } from "../../lib/format";

const WIZARD_SCOPES = AGENT_SCOPES.filter((scope) => !scope.startsWith("agents:") && scope !== "finance:draft");

/**
 * «Подключить агента» (TZ-02, 2.6): pick the client → issue a token with sensible permissions → get the exact
 * configuration for THIS install (real node.exe and adapter paths, supplied by the server) → copy → check.
 */
export function AgentConnectWizard({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const connection = useAgentConnection(workspaceId);
  const create = useCreateAgentToken(workspaceId);
  const [client, setClient] = useState<AgentClient>("claude-desktop");
  const [scopes, setScopes] = useState<AgentScope[]>([...AGENT_RECOMMENDED_SCOPES]);
  const [issued, setIssued] = useState<{ token: CreatedAgentToken; client: AgentClient } | null>(null);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const install = useInstallAgentClient(workspaceId);
  const [installed, setInstalled] = useState<InstalledAgentClient | null>(null);

  const info = connection.data;
  /** One click works for the programs ORION knows the config of, on a local install with the MCP adapter present. */
  const canInstall = Boolean(info?.bridgeEnabled && info.mode === "local" && info.command) && (AGENT_INSTALL_CLIENTS as readonly string[]).includes(client);

  async function installNow(): Promise<void> {
    try {
      setInstalled(await install.mutateAsync({ client: client as AgentInstallClient, scopes }));
    } catch (error) {
      toast({ title: "Не удалось подключить автоматически", description: `${describeError(error)} Можно подключить вручную — кнопка рядом.`, tone: "danger" });
    }
  }
  const snippet = issued && info ? buildConnectSnippet(issued.client, info, issued.token.secret) : null;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const token = await create.mutateAsync({ name: AGENT_CLIENT_LABEL[client], scopes, expiresInDays: 90 });
      setIssued({ token, client });
      setCheck(null);
    } catch (error) {
      toast({ title: "Не удалось выпустить токен", description: describeError(error), tone: "danger" });
    }
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Скопировано", tone: "success" });
    } catch {
      toast({ title: "Не удалось скопировать — выделите текст вручную", tone: "danger" });
    }
  }

  async function verify(): Promise<void> {
    if (!issued || !info) return;
    setChecking(true);
    setCheck(await checkAgentConnection(info.apiUrl ?? "http://127.0.0.1:4000", issued.token.secret));
    setChecking(false);
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-label font-medium">Подключить программу</h3>
        <p className="text-xs text-muted-foreground">
          Выберите программу и что ей разрешить — ORION подключит её сам или покажет настройку, чтобы вставить вручную. Ни исходники, ни Node не нужны.
        </p>
      </div>

      {installed ? (
        <InstalledCard workspaceId={workspaceId} installed={installed} onDone={() => setInstalled(null)} />
      ) : info && !info.bridgeEnabled ? (
        <p className="text-label text-danger">Мост для агентов выключен на этом сервере (нужен ORION_AI_BRIDGE=1).</p>
      ) : issued ? (
        <div className="space-y-3">
          <p className="text-label font-medium">
            Токен «{issued.token.name}» создан. {AGENT_CLIENT_LABEL[issued.client]}: скопируйте настройку — секрет позже не будет показан.
          </p>
          {snippet ? (
            <>
              <p className="text-xs text-muted-foreground">{snippet.where}</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{snippet.text}</pre>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void copy(snippet.text)}>
                  Копировать
                </Button>
                <Button size="sm" variant="outline" disabled={checking} onClick={() => void verify()}>
                  {checking ? "Проверяю…" : "Проверить подключение"}
                </Button>
                {check ? <span className={check.ok ? "text-label text-success" : "text-label text-danger"}>{check.message}</span> : null}
              </div>
            </>
          ) : (
            <p className="text-label text-muted-foreground">
              В этой установке нет MCP-адаптера для запуска на вашем компьютере. Агент может работать по REST: выберите «Другой клиент» или откройте руководство агента (GET /ai/v1/manual).
            </p>
          )}
          {info?.launcher === "repo" ? (
            <p className="text-xs text-muted-foreground">Это сборка из исходников: используется scripts/orion-mcp.mjs; в установленной версии путь будет к встроенному Node.</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Первое, что должен сделать агент, — вызвать <code>orion_get_context</code>; руководство — <code>orion_get_manual</code>
            {info?.manualPath ? <> (файл: <code>{info.manualPath}</code>)</> : null}.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
            Готово
          </Button>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Программа</span>
            <Select value={client} onChange={(event) => setClient(event.target.value as AgentClient)} className="w-auto">
              {AGENT_CLIENTS.map((item) => (
                <option key={item} value={item}>
                  {AGENT_CLIENT_LABEL[item]}
                </option>
              ))}
            </Select>
          </label>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs text-muted-foreground">Что разрешить (удалять агент не может в любом случае)</legend>
            {WIZARD_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-1.5 text-label">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]))}
                  className="accent-accent"
                />
                {AGENT_SCOPE_LABEL[scope]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {canInstall ? (
              <Button type="button" size="sm" disabled={install.isPending || scopes.length === 0} onClick={() => void installNow()}>
                {install.isPending ? "Подключаю…" : `Подключить ${AGENT_CLIENT_LABEL[client]} автоматически`}
              </Button>
            ) : null}
            <Button type="submit" size="sm" variant={canInstall ? "outline" : "primary"} disabled={create.isPending || scopes.length === 0 || connection.isLoading}>
              {canInstall ? "Настроить вручную" : "Выпустить токен и показать настройку"}
            </Button>
          </div>
          {canInstall ? (
            <p className="text-xs text-muted-foreground">
              Автоматически: ORION допишет себя в настройки {AGENT_CLIENT_LABEL[client]} на этом компьютере (прежний файл сохранится рядом
              копией). Агент будет работать по вашей подписке в этой программе.
            </p>
          ) : null}
        </form>
      )}
    </Card>
  );
}

/** After a one-click install: where it was written, what to do next, and whether the program has called ORION yet. */
function InstalledCard({ workspaceId, installed, onDone }: { workspaceId: string | undefined; installed: InstalledAgentClient; onDone: () => void }): React.ReactElement {
  const tokens = useAgentTokens(workspaceId, { pollMs: 3_000 });
  const token = (tokens.data ?? []).find((item) => item.name === installed.tokenName && item.revokedAt === null);
  return (
    <div className="space-y-2" role="status">
      <p className="text-label font-medium">ORION добавлен в настройки {installed.tokenName}.</p>
      <p className="text-xs text-muted-foreground">
        Файл: <code className="break-all">{installed.configPath}</code>
        {installed.backupPath ? (
          <>
            {" "}· прежний сохранён как <code className="break-all">{installed.backupPath}</code>
          </>
        ) : null}
        {installed.revokedPrevious > 0 ? ` · прежних токенов отозвано: ${installed.revokedPrevious}` : ""}
      </p>
      <p className="text-label">{installed.restartHint}</p>
      <p className={token?.lastUsedAt ? "text-label text-success" : "text-label text-muted-foreground"}>
        {token?.lastUsedAt ? `Подключено — последнее обращение ${relativeTime(token.lastUsedAt)}.` : "Жду первого обращения программы к ORION…"}
      </p>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Готово
      </Button>
    </div>
  );
}
