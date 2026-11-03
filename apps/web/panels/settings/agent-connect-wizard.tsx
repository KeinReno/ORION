"use client";

import { useAgentConnection, useAgentTokens, useCreateAgentToken, useInstallAgentClient, useSetAiBridgeOverride } from "@orion/core-react";
import {
  AGENT_INSTALL_CLIENTS,
  AGENT_MODES,
  AGENT_MODE_LABEL,
  AGENT_MODE_HINT,
  AGENT_RECOMMENDED_SCOPES,
  AGENT_SCOPES,
  AGENT_SCOPE_LABEL,
  type AgentConnectionInfo,
  type AgentInstallClient,
  type AgentScope,
  type AgentMode,
  type CreatedAgentToken,
  type InstalledAgentClient
} from "@orion/shared-types";
import { Button, Card, ConfirmDialog, SegmentedControl, Select, useToast } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { AGENT_CLIENTS, AGENT_CLIENT_LABEL, buildConnectSnippet, checkAgentConnection, type AgentClient, type ConnectionCheck } from "../../lib/agent-connect";
import { describeError } from "../../lib/error-message";
import { ModulePermissionsField } from "./agent-permissions";
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
  const [modulePermissions, setModulePermissions] = useState<string[]>([]);
  const [mode, setMode] = useState<AgentMode>("assistant");
  const [expiry, setExpiry] = useState("none");
  const [customDays, setCustomDays] = useState("365");
  const [confirmAdmin, setConfirmAdmin] = useState<"install" | "manual" | null>(null);
  const expiresInDays = expiry === "none" ? null : expiry === "custom" ? Number(customDays) : Number(expiry);
  const expiryValid = expiresInDays === null || (Number.isInteger(expiresInDays) && expiresInDays >= 1 && expiresInDays <= 36_500);
  const grantValid = mode === "admin" || scopes.length > 0 || modulePermissions.length > 0;
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
      setInstalled(await install.mutateAsync({ client: client as AgentInstallClient, scopes, modulePermissions, mode, expiresInDays }));
    } catch (error) {
      toast({ title: "Не удалось подключить автоматически", description: `${describeError(error)} Можно подключить вручную — кнопка рядом.`, tone: "danger" });
    }
  }
  const snippet = issued && info ? buildConnectSnippet(issued.client, info, issued.token.secret) : null;

  async function issueManual(): Promise<void> {
    try {
      const token = await create.mutateAsync({ name: AGENT_CLIENT_LABEL[client], scopes, modulePermissions, mode, expiresInDays });
      setIssued({ token, client });
      setCheck(null);
    } catch (error) {
      toast({ title: "Не удалось выпустить токен", description: describeError(error), tone: "danger" });
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!expiryValid || !grantValid) return;
    if (mode === "admin") setConfirmAdmin("manual");
    else void issueManual();
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

      {info?.bridgeOverrideEditable ? <BridgeOverrideControl workspaceId={workspaceId} info={info} /> : null}

      {installed ? (
        <InstalledCard workspaceId={workspaceId} installed={installed} onDone={() => setInstalled(null)} />
      ) : info && !info.bridgeEnabled ? (
        <p className="text-label text-danger">{info.bridgeDisabledReason ?? "Мост для агентов выключен на этом сервере (нужен ORION_AI_BRIDGE=1)."}</p>
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
        <form onSubmit={submit} className="space-y-3">
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
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Роль</span>
              <Select value={mode} onChange={(event) => setMode(event.target.value as AgentMode)} className="w-auto">
                {AGENT_MODES.map((value) => <option key={value} value={value}>{AGENT_MODE_LABEL[value]}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Срок действия</span>
              <Select value={expiry} onChange={(event) => setExpiry(event.target.value)} className="w-auto">
                <option value="none">Бессрочно</option>
                <option value="1">1 день</option>
                <option value="7">7 дней</option>
                <option value="30">30 дней</option>
                <option value="90">90 дней</option>
                <option value="365">1 год</option>
                <option value="custom">Свой срок</option>
              </Select>
            </label>
            {expiry === "custom" ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Дней (1–36500)</span>
                <input type="number" min={1} max={36500} value={customDays} onChange={(event) => setCustomDays(event.target.value)}
                  className="w-28 rounded-md border border-border bg-background px-2 py-1 text-label" />
              </label>
            ) : null}
          </div>
          <p className={mode === "admin" ? "text-label text-warning" : "text-2xs text-muted-foreground"}>
            {AGENT_MODE_HINT[mode]} {expiresInDays === null ? "Доступ бессрочный до явного отзыва." : ""}
          </p>
          {mode === "admin" ? (
            <p className="rounded border border-warning/40 p-2 text-label text-warning">
              Администратор может выполнять операции без подтверждения. Выдавать эту роль вправе только владелец рабочего пространства.
            </p>
          ) : null}
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs text-muted-foreground">Разрешения для выбранной роли (администратор не ограничен матрицей)</legend>
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
          <ModulePermissionsField value={modulePermissions} onChange={setModulePermissions} />
          <div className="flex flex-wrap gap-2">
            {canInstall ? (
              <Button type="button" size="sm" disabled={install.isPending || !grantValid || !expiryValid} onClick={() => mode === "admin" ? setConfirmAdmin("install") : void installNow()}>
                {install.isPending ? "Подключаю…" : `Подключить ${AGENT_CLIENT_LABEL[client]} автоматически`}
              </Button>
            ) : null}
            <Button type="submit" size="sm" variant={canInstall ? "outline" : "primary"} disabled={create.isPending || !grantValid || !expiryValid || connection.isLoading}>
              {canInstall ? "Настроить вручную" : "Выпустить токен и показать настройку"}
            </Button>
          </div>
          {canInstall ? (
            <p className="text-xs text-muted-foreground">
              Автоматически: ORION сохранит токен в отдельном приватном файле, добавит путь к нему в настройки {AGENT_CLIENT_LABEL[client]} и проверит авторизацию API. Для завершения перезапустите клиент. Прежняя конфигурация сохраняется резервной копией.
            </p>
          ) : null}
          <ConfirmDialog
            open={confirmAdmin !== null}
            title="Выдать права администратора?"
            description="Этот агент сможет изменять и удалять данные без дополнительных подтверждений. Бессрочный доступ сохранится до отзыва. Продолжить?"
            confirmLabel="Выдать доступ"
            danger
            onConfirm={() => {
              const action = confirmAdmin;
              setConfirmAdmin(null);
              if (action === "install") void installNow();
              else if (action === "manual") void issueManual();
            }}
            onCancel={() => setConfirmAdmin(null)}
          />
        </form>
      )}
    </Card>
  );
}

/**
 * ORION-12: the owner's explicit choice, persisted on the node (not an env var) and effective
 * immediately — no restart. "Включён" while this node is in server mode (or LAN Host is on) is
 * a real widening of access, so it asks for confirmation instead of flipping silently; turning
 * it off, or choosing "Авто", never needs one.
 */
function BridgeOverrideControl({ workspaceId, info }: { workspaceId: string | undefined; info: AgentConnectionInfo }): React.ReactElement {
  const { toast } = useToast();
  const setOverride = useSetAiBridgeOverride(workspaceId);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const value = info.bridgeOverride === null ? "auto" : info.bridgeOverride ? "on" : "off";
  const risky = info.mode === "server";

  function apply(next: boolean | null): void {
    setOverride.mutate(
      { override: next },
      { onError: (error) => toast({ title: "Не удалось изменить", description: describeError(error), tone: "danger" }) }
    );
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label font-medium">Мост для агентов</p>
        <SegmentedControl<"auto" | "on" | "off">
          aria-label="Мост для агентов"
          size="sm"
          value={value}
          onChange={(next) => {
            if (next === "on" && risky) setConfirmEnable(true);
            else apply(next === "auto" ? null : next === "on");
          }}
          options={[
            { value: "auto", label: "Авто" },
            { value: "on", label: "Включён" },
            { value: "off", label: "Выключен" }
          ]}
        />
      </div>
      <p className="text-2xs text-subtle-foreground">
        {value === "auto"
          ? "Авто — включён на личном устройстве, выключен в серверном режиме, пока не задан ORION_AI_BRIDGE."
          : value === "on"
            ? "Включён явно — доступен независимо от режима."
            : "Выключен явно — не работает, даже на личном устройстве."}
      </p>
      <ConfirmDialog
        open={confirmEnable}
        title="Включить мост для агентов?"
        description={`Этот узел сейчас ${info.mode === "server" ? "в серверном режиме" : "хостом LAN"} — включение моста сделает его доступным любому, кто может подключиться к серверу, а не только вам на этом компьютере.`}
        confirmLabel="Включить"
        danger={false}
        onConfirm={() => {
          setConfirmEnable(false);
          apply(true);
        }}
        onCancel={() => setConfirmEnable(false)}
      />
    </div>
  );
}

/** After a one-click install: where it was written, what to do next, and whether the program has called ORION yet. */
function InstalledCard({ workspaceId, installed, onDone }: { workspaceId: string | undefined; installed: InstalledAgentClient; onDone: () => void }): React.ReactElement {
  const tokens = useAgentTokens(workspaceId, { pollMs: 3_000 });
  const token = (tokens.data ?? []).find((item) => item.name === installed.tokenName && item.revokedAt === null);
  return (
    <div className="space-y-2" role="status">
      <p className="text-label font-medium">ORION добавлен в настройки {installed.tokenName}. API-авторизация проверена; MCP-клиент нужно перезапустить.</p>
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
        {token?.lastUsedAt ? `Последний запрос к API ${relativeTime(token.lastUsedAt)} (автопроверка или клиент).` : "Жду обращения к API ORION…"}
      </p>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Готово
      </Button>
    </div>
  );
}
