"use client";

import { useAgentTokens, useAssistantKey, useCreateAgentToken, useRevokeAgentToken, useRevokeAllAgentTokens, useUpdateAgentToken } from "@orion/core-react";
import {
  AGENT_MODES,
  AGENT_MODE_HINT,
  AGENT_MODE_LABEL,
  AGENT_PERMISSION_MODULE_LABEL,
  AGENT_PERMISSION_OP_LABEL,
  ASSISTANT_CHAT_TOKEN_NAME,
  describeAgentPermissions,
  effectiveAgentPermissions,
  type AgentMode,
  type AgentToken,
  type CreatedAgentToken
} from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, Input, SegmentedControl, Select, Skeleton, useToast } from "@orion/ui";
import { Bot } from "lucide-react";
import { useState, type FormEvent } from "react";
import { agentLabel, describePresence, useAgentPresenceNow } from "../../lib/agent-presence";
import { describeError } from "../../lib/error-message";
import { relativeTime, shortDate } from "../../lib/format";
import { openPanel } from "../../lib/panel-bus";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { AssistantKeyForm, AssistantModelPicker, ClearAssistantKeyButton } from "../assistant-key";
import { AgentConnectWizard } from "./agent-connect-wizard";
import { AgentPolicyFields, TokenPolicyEditor, defaultPolicy, describeModulePermissions, policyIsEmpty, policyToInput, type PolicyDraft } from "./agent-permissions";
import { AgentJournal } from "./agents-journal";
import { AgentProposals } from "./agents-proposals";

/** A token with no expiry is allowed, but it is a standing key: the list warns about it. */
const NO_EXPIRY = "none";

type AiSection = "connections" | "assistant" | "journal";
const SECTION_KEY = "orion.settings.ai.section";

function rememberedSection(): AiSection {
  try {
    const saved = localStorage.getItem(SECTION_KEY);
    return saved === "assistant" || saved === "journal" ? saved : "connections";
  } catch {
    return "connections";
  }
}

const isLive = (token: AgentToken): boolean => token.revokedAt === null && (token.expiresAt === null || Date.parse(token.expiresAt) > Date.now());

/**
 * «ИИ и агенты»: everything about AI in one place, split by what you came to do —
 *  · requests waiting for your confirmation, always on top;
 *  · «Подключения»: connect a program (Claude Desktop, Claude Code, Cursor — on YOUR subscription, through MCP) in one
 *    click, and the programs already connected as cards with their live status;
 *  · «Ассистент»: the built-in chat's own key and model;
 *  · «Журнал»: every call, with undo.
 * The assistant's per-message tokens («Чат ORION») are an implementation detail and are not listed.
 */
export function AgentsSettings(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const [section, setSection] = useState<AiSection>(rememberedSection);

  function choose(next: AiSection): void {
    setSection(next);
    try {
      localStorage.setItem(SECTION_KEY, next);
    } catch {
      /* a remembered tab is a convenience only */
    }
  }

  return (
    <div className="space-y-5">
      <AgentProposals workspaceId={workspaceId} />
      <SegmentedControl<AiSection>
        aria-label="Раздел ИИ"
        value={section}
        onChange={choose}
        options={[
          { value: "connections", label: "Подключения" },
          { value: "assistant", label: "Ассистент" },
          { value: "journal", label: "Журнал" }
        ]}
      />
      {section === "connections" ? <Connections workspaceId={workspaceId} /> : null}
      {section === "assistant" ? <AssistantSection /> : null}
      {section === "journal" ? <AgentJournal workspaceId={workspaceId} /> : null}
    </div>
  );
}

function Connections({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const tokens = useAgentTokens(workspaceId);
  const revokeAll = useRevokeAllAgentTokens(workspaceId);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const external = (tokens.data ?? []).filter((token) => token.name !== ASSISTANT_CHAT_TOKEN_NAME);
  const live = external.filter(isLive);
  const inactive = external.filter((token) => !isLive(token));

  return (
    <div className="space-y-5">
      <p className="text-label text-muted-foreground">
        Подключите программу, которой пользуетесь, — Claude Desktop, Claude Code, Cursor или Codex. Агент работает по вашей
        подписке в этой программе и действует в ORION от вашего имени, только в рамках выбранных разрешений. Уже подключённую
        программу можно изменить в любой момент: разрешить или запретить действие, поднять или снизить лимит записей. Удалять
        сразу может только режим «Администратор», и только если запрет на удаление не стоит. Что агент делает, видно сразу —
        плашкой в шапке и рамкой вокруг раздела.
      </p>

      <AgentConnectWizard workspaceId={workspaceId} />

      <section className="space-y-2" aria-label="Подключённые программы">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-label font-medium">Подключённые программы</h3>
          {live.length > 0 ? (
            <Button size="sm" variant="outline" className="ml-auto" disabled={revokeAll.isPending} onClick={() => setConfirmRevokeAll(true)}>
              Отключить все
            </Button>
          ) : null}
        </div>
        {tokens.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : live.length === 0 ? (
          <p className="text-label text-muted-foreground">Пока ничего не подключено.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {live.map((token) => (
              <ConnectionCard key={token.id} workspaceId={workspaceId} token={token} />
            ))}
          </ul>
        )}
        {inactive.length > 0 ? (
          <div className="space-y-2">
            <Button size="sm" variant="ghost" onClick={() => setShowInactive((value) => !value)} aria-expanded={showInactive}>
              {showInactive ? "Скрыть отключённые" : `Отключённые и истёкшие · ${inactive.length}`}
            </Button>
            {showInactive ? (
              <ul className="space-y-1">
                {inactive.map((token) => (
                  <li key={token.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-label text-muted-foreground">
                    <span className="font-medium text-foreground">{token.name}</span>
                    <code className="text-2xs">{token.prefix}…</code>
                    <Badge>{token.revokedAt ? "отключено" : "истёк срок"}</Badge>
                    <span className="ml-auto text-2xs">{token.lastUsedAt ? `последняя активность ${relativeTime(token.lastUsedAt)}` : "не использовался"}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <ManualToken workspaceId={workspaceId} />

      <ConfirmDialog
        open={confirmRevokeAll}
        title="Отключить все программы?"
        confirmLabel="Отключить"
        description="Все ваши агенты сразу потеряют доступ к этому пространству. Подключить их снова можно в любой момент."
        onConfirm={() => {
          setConfirmRevokeAll(false);
          revokeAll.mutate(undefined, {
            onSuccess: (count) => toast({ title: `Отключено: ${count}`, tone: "success" }),
            onError: () => toast({ title: "Не удалось отключить", tone: "danger" })
          });
        }}
        onCancel={() => setConfirmRevokeAll(false)}
      />
    </div>
  );
}

/** One connected program: live status, what it may do, mode, expiry and «Отключить». */
function ConnectionCard({ workspaceId, token }: { workspaceId: string | undefined; token: AgentToken }): React.ReactElement {
  const { toast } = useToast();
  const update = useUpdateAgentToken(workspaceId);
  const revoke = useRevokeAgentToken(workspaceId);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const working = useAgentPresenceNow().agents.find((event) => event.tokenId === token.id);
  return (
    <li className={editing ? "md:col-span-2" : undefined}>
      <Card className="h-full space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-4 w-4 text-accent" aria-hidden />
          <span className="font-medium">{token.name}</span>
          <code className="text-2xs text-muted-foreground">{token.prefix}…</code>
          {token.expiresAt === null ? <Badge tone="warning">без срока</Badge> : null}
        </div>
        <p className={working ? "text-label text-accent" : "text-label text-muted-foreground"} role="status">
          {working
            ? `Работает сейчас: ${describePresence(working)}`
            : token.lastUsedAt
              ? `Последняя активность ${relativeTime(token.lastUsedAt)}`
              : "Ещё не обращался к ORION"}
          {token.expiresAt ? <span className="text-subtle-foreground"> · действует до {shortDate(token.expiresAt)}</span> : null}
        </p>
        <p className="text-2xs text-muted-foreground">
          {describeAgentPermissions(effectiveAgentPermissions(token.scopes, token.permissions), AGENT_PERMISSION_MODULE_LABEL, AGENT_PERMISSION_OP_LABEL)}
          {token.allowedProjectIds.length > 0 ? ` · проектов: ${token.allowedProjectIds.length}` : ""}
          {token.writeLimitPerHour ? ` · до ${token.writeLimitPerHour} записей/час` : ""}
          {token.forbidden.length > 0 ? ` · запрет: ${token.forbidden.join(", ")}` : ""}
          {token.modulePermissions.length > 0 ? ` · ${describeModulePermissions(token.modulePermissions)}` : ""}
        </p>
        {editing ? (
          <TokenPolicyEditor workspaceId={workspaceId} token={token} onClose={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label={`Режим: ${token.name}`}
                value={token.mode}
                title={AGENT_MODE_HINT[token.mode]}
                onChange={(event) =>
                  update.mutate(
                    { tokenId: token.id, input: { mode: event.target.value as AgentMode } },
                    { onError: (error) => toast({ title: "Не удалось сменить режим", description: describeError(error), tone: "danger" }) }
                  )
                }
                className="w-auto"
              >
                {AGENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {AGENT_MODE_LABEL[mode]}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Настроить
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirm(true)}>
                Отключить
              </Button>
            </div>
            <p className="text-2xs text-subtle-foreground">{AGENT_MODE_HINT[token.mode]}</p>
          </>
        )}
      </Card>
      <ConfirmDialog
        open={confirm}
        title={`Отключить «${token.name}»?`}
        confirmLabel="Отключить"
        description="Программа сразу потеряет доступ к этому пространству."
        onConfirm={() => {
          setConfirm(false);
          revoke.mutate(token.id, { onError: () => toast({ title: "Не удалось отключить", tone: "danger" }) });
        }}
        onCancel={() => setConfirm(false)}
      />
    </li>
  );
}

/** «Дополнительно»: a token with your own permissions, projects and limits — for a script or an unusual client. */
function ManualToken({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const create = useCreateAgentToken(workspaceId);
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState<PolicyDraft>(defaultPolicy);
  const [days, setDays] = useState("none");
  const [customDays, setCustomDays] = useState("365");
  const chosenDays = days === NO_EXPIRY ? null : days === "custom" ? Number(customDays) : Number(days);
  const validDays = chosenDays === null || (Number.isInteger(chosenDays) && chosenDays >= 1 && chosenDays <= 36_500);
  const [issued, setIssued] = useState<CreatedAgentToken | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      if (!validDays) return;
      const created = await create.mutateAsync({ name, ...policyToInput(policy), expiresInDays: chosenDays });
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
    <details className="group rounded-xl border border-border px-4 py-3">
      <summary className="cursor-pointer text-label font-medium text-foreground">
        Дополнительно: токен вручную — свои разрешения, проекты и лимиты
      </summary>
      <div className="mt-3 space-y-3">
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
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Скрипт отчётов" required maxLength={80} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Срок</span>
              <Select value={days} onChange={(event) => setDays(event.target.value)} className="w-auto">
                <option value="7">7 дней</option>
                <option value="30">30 дней</option>
                <option value="90">90 дней</option>
                <option value="365">1 год</option>
                <option value="custom">Свой срок</option>
                <option value={NO_EXPIRY}>Бессрочно (до отзыва)</option>
              </Select>
            </label>
          </div>
          {days === "custom" ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Срок (1–36500 дней)</span>
              <Input type="number" min={1} max={36500} value={customDays} onChange={(event) => setCustomDays(event.target.value)} />
            </label>
          ) : null}
          <AgentPolicyFields workspaceId={workspaceId} draft={policy} onChange={setPolicy} />
          <Button type="submit" size="sm" disabled={create.isPending || !name.trim() || policyIsEmpty(policy) || !validDays}>
            Выпустить токен
          </Button>
        </form>
      </div>
    </details>
  );
}

/** The built-in chat: its key (yours, on this computer, for every workspace) and model. */
function AssistantSection(): React.ReactElement {
  const key = useAssistantKey();
  const { agents } = useAgentPresenceNow();
  const thinking = agents.find((event) => event.assistant);
  if (key.isLoading) return <Skeleton className="h-24 w-full" />;
  if (key.isError || !key.data) return <p className="text-label text-destructive">Не удалось проверить настройки ассистента.</p>;
  if (!key.data.available) return <p className="text-label text-muted-foreground">Ассистент недоступен на этом узле: {key.data.reason}</p>;
  return (
    <div className="space-y-4">
      <p className="text-label text-muted-foreground">
        Чат внутри ORION (раздел «Ассистент»). Работает через ваш API-ключ Anthropic — он общий для всех ваших пространств и хранится
        зашифрованным только на этом компьютере. Изменения существующего ассистент только предлагает; подтвердить можно прямо в чате.
      </p>
      {key.data.configured ? (
        <Card className="space-y-3 px-4 py-3">
          <p className="text-label">
            Ключ сохранён · модель <span className="font-medium">{key.data.model}</span>
            {thinking ? <span className="text-accent"> · {agentLabel(thinking)} {describePresence(thinking)}</span> : null}
          </p>
          <AssistantModelPicker current={key.data.model ?? ""} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openPanel("assistant")}>
              Открыть чат
            </Button>
            <ClearAssistantKeyButton />
          </div>
        </Card>
      ) : (
        <AssistantKeyForm />
      )}
    </div>
  );
}
