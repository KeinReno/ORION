"use client";

import { useProjects, useUpdateAgentToken } from "@orion/core-react";
import {
  AGENT_FORBIDDEN,
  AGENT_FORBIDDEN_LABEL,
  AGENT_MODES,
  AGENT_MODE_HINT,
  AGENT_MODE_LABEL,
  AGENT_PERMISSION_MODULES,
  AGENT_PERMISSION_MODULE_LABEL,
  AGENT_PERMISSION_OPS,
  AGENT_PERMISSION_OP_LABEL,
  AGENT_SCOPE_LABEL,
  MODULE_AGENT_PERMISSIONS,
  MODULE_PERMISSION_ACTION_LABEL,
  permissionsFromScopes,
  type OrionModuleId,
  type AgentForbidden,
  type AgentMode,
  type AgentPermissionModule,
  type AgentPermissionOp,
  type AgentPermissions,
  type AgentScope,
  type AgentToken,
  type CreateAgentTokenInput
} from "@orion/shared-types";
import { Button, Input, useToast } from "@orion/ui";
import { useState } from "react";
import { ChoiceSelect } from "../../components/choice-select";
import { describeError } from "../../lib/error-message";
import { useEnabledModules } from "../../lib/use-enabled-modules";

/** Non-matrix scopes: agent-to-agent traffic and links. */
const EXTRA_SCOPES: AgentScope[] = ["agents:message", "agents:delegate", "links:write"];

/** Which ops make sense per module: projects are read-only, finance only ever produces drafts a human confirms. */
const OPS_FOR: Record<AgentPermissionModule, AgentPermissionOp[]> = {
  tasks: ["read", "create", "update", "propose"],
  notes: ["read", "create", "update", "propose"],
  events: ["read", "create", "update", "propose"],
  projects: ["read"],
  finance: ["create"]
};

/**
 * ORION-13: a cell the matrix never offers (the "·" placeholder) used to give no reason at all — exactly
 * the "некликабельный чекбокс без объяснения" complaint. These are capability limits of the agent API
 * itself (see `OPS_FOR`'s own comment), not a UI bug to silently "unlock" — that's the risk note in
 * ORION-13: unblocking only the checkbox without matching server support would be a lie the UI tells.
 */
const OP_UNAVAILABLE_REASON: Partial<Record<AgentPermissionModule, string>> = {
  projects: "Проекты агенту доступны только для чтения — создание и изменение проектов через API агентов не предусмотрено.",
  finance: "Финансовые операции агент может только предложить черновиком (создать проводку, которую вы подтверждаете) — читать или менять существующие операции агенту не даётся."
};

export interface PolicyDraft {
  mode: AgentMode;
  matrix: Required<AgentPermissions>;
  extraScopes: AgentScope[];
  allowedProjectIds: string[];
  forbidden: AgentForbidden[];
  writeLimit: string;
  autoCommitProjectIds: string[];
  /** Registry permissions of module tools: habits, lists, time, contacts, documents, finance (read), inventory… */
  modulePermissions: string[];
}

export const defaultPolicy = (): PolicyDraft => ({
  mode: "assistant",
  matrix: { tasks: ["read", "create", "propose"], notes: ["read", "create", "propose"], events: ["read"], projects: ["read"], finance: [] },
  extraScopes: [],
  allowedProjectIds: [],
  forbidden: ["delete"],
  writeLimit: "",
  modulePermissions: [],
  autoCommitProjectIds: []
});

/**
 * ORION-13: «профили привилегий» — a starting point for the matrix below, not a locked-in choice.
 * Applying one only touches mode/matrix/forbidden/extraScopes: project scoping, the write limit and
 * module permissions are a separate decision (what's in scope, not how much the agent can do inside
 * it) and stay exactly as the owner already set them.
 */
export const AGENT_POLICY_PRESETS: { id: string; label: string; description: string; apply: (draft: PolicyDraft) => PolicyDraft }[] = [
  {
    id: "observer",
    label: "Наблюдатель",
    description: "Только читает — ничего не создаёт и не меняет нигде.",
    apply: (draft) => ({
      ...draft,
      mode: "observer",
      matrix: { tasks: ["read"], notes: ["read"], events: ["read"], projects: ["read"], finance: [] },
      forbidden: ["delete"],
      extraScopes: []
    })
  },
  {
    id: "assistant",
    label: "Помощник",
    description: "Создаёт задачи/заметки и предлагает изменения — ничего не делает напрямую без подтверждения.",
    apply: (draft) => ({
      ...draft,
      mode: "assistant",
      matrix: { tasks: ["read", "create", "propose"], notes: ["read", "create", "propose"], events: ["read"], projects: ["read"], finance: [] },
      forbidden: ["delete"]
    })
  },
  {
    id: "trusted",
    label: "Доверенный помощник",
    description: "Меняет существующие задачи/заметки напрямую, без подтверждения на каждую правку — удалять всё ещё не может.",
    apply: (draft) => ({
      ...draft,
      mode: "assistant",
      matrix: { tasks: ["read", "create", "update"], notes: ["read", "create", "update"], events: ["read"], projects: ["read"], finance: ["create"] },
      forbidden: ["delete"]
    })
  },
  {
    id: "admin",
    label: "Администратор",
    description: "Делает всё сразу и без подтверждений, в любом модуле — включая удаление. Без предохранителей: выдавайте только токену, которому доверяете полностью.",
    apply: (draft) => ({
      ...draft,
      mode: "admin",
      // Not consulted by the server in this mode (agent-policy.ts) — cleared so the matrix UI doesn't
      // imply a boundary that isn't actually enforced.
      matrix: { tasks: [], notes: [], events: [], projects: [], finance: [] },
      forbidden: [],
      extraScopes: []
    })
  }
];

/** The request body for `POST agent-tokens` minus name and expiry. */
export function policyToInput(draft: PolicyDraft): Pick<CreateAgentTokenInput, "mode" | "permissions" | "scopes" | "allowedProjectIds" | "forbidden" | "writeLimitPerHour" | "autoCommitProjectIds" | "modulePermissions"> {
  const limit = Number(draft.writeLimit);
  return {
    mode: draft.mode,
    permissions: draft.matrix,
    scopes: draft.extraScopes,
    allowedProjectIds: draft.allowedProjectIds,
    forbidden: draft.forbidden,
    writeLimitPerHour: draft.writeLimit.trim() !== "" && Number.isInteger(limit) && limit > 0 ? limit : null,
    autoCommitProjectIds: draft.mode === "manager" ? draft.autoCommitProjectIds : [],
    modulePermissions: draft.modulePermissions
  };
}

/** The editor for a token that already exists: same fields as creation, filled from what the token has now. */
export function policyFromToken(token: Pick<AgentToken, "mode" | "scopes" | "permissions" | "allowedProjectIds" | "forbidden" | "writeLimitPerHour" | "autoCommitProjectIds" | "modulePermissions">): PolicyDraft {
  const stored = token.permissions;
  const matrix = stored
    ? {
        tasks: [...(stored.tasks ?? [])],
        notes: [...(stored.notes ?? [])],
        events: [...(stored.events ?? [])],
        projects: [...(stored.projects ?? [])],
        finance: [...(stored.finance ?? [])]
      }
    : permissionsFromScopes(token.scopes);
  return {
    mode: token.mode,
    matrix,
    extraScopes: token.scopes.filter((scope): scope is AgentScope => (EXTRA_SCOPES as readonly string[]).includes(scope)),
    allowedProjectIds: [...token.allowedProjectIds],
    forbidden: [...token.forbidden],
    writeLimit: token.writeLimitPerHour === null ? "" : String(token.writeLimitPerHour),
    autoCommitProjectIds: [...token.autoCommitProjectIds],
    modulePermissions: [...token.modulePermissions]
  };
}

/** Save the current policy of a live token: allow, deny, raise or lower the write limit. */
export function TokenPolicyEditor({
  workspaceId,
  token,
  onClose
}: {
  workspaceId: string | undefined;
  token: AgentToken;
  onClose: () => void;
}): React.ReactElement {
  const { toast } = useToast();
  const update = useUpdateAgentToken(workspaceId);
  const [draft, setDraft] = useState(() => policyFromToken(token));
  const [expiry, setExpiry] = useState("keep");
  const [customDays, setCustomDays] = useState("365");
  const newExpiry = expiry === "none" ? null : expiry === "custom" ? Number(customDays) : Number(expiry);
  const validExpiry = expiry === "keep" || newExpiry === null || (Number.isInteger(newExpiry) && newExpiry >= 1 && newExpiry <= 36_500);

  async function save(): Promise<void> {
    try {
      if (!validExpiry) return;
      await update.mutateAsync({ tokenId: token.id, input: { ...policyToInput(draft), ...(expiry === "keep" ? {} : { expiresInDays: newExpiry }) } });
      toast({ title: "Настройки сохранены", description: `«${token.name}» будет работать с ними со следующего обращения.`, tone: "success" });
      onClose();
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <AgentPolicyFields workspaceId={workspaceId} draft={draft} onChange={setDraft} />
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[14rem] space-y-1">
          <span className="text-xs text-muted-foreground">Изменить срок действия</span>
          <ChoiceSelect
            label="Изменить срок действия"
            value={expiry}
            options={[
              { value: "keep", label: "Не менять" },
              { value: "none", label: "Бессрочно" },
              { value: "7", label: "7 дней от текущего момента" },
              { value: "30", label: "30 дней" },
              { value: "90", label: "90 дней" },
              { value: "365", label: "1 год" },
              { value: "custom", label: "Свой срок" }
            ]}
            onChange={setExpiry}
          />
        </div>
        {expiry === "custom" ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Дней (1–36500)</span>
            <Input type="number" min={1} max={36500} value={customDays} onChange={(event) => setCustomDays(event.target.value)} className="w-28" />
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={update.isPending || policyIsEmpty(draft) || !validExpiry} onClick={() => void save()}>
          Сохранить
        </Button>
        <Button size="sm" variant="ghost" disabled={update.isPending} onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/** True when the matrix grants nothing and no extra scope is ticked: the server would refuse it. Admin needs none of that. */
export const policyIsEmpty = (draft: PolicyDraft): boolean =>
  draft.mode !== "admin" &&
  draft.extraScopes.length === 0 &&
  draft.modulePermissions.length === 0 &&
  AGENT_PERMISSION_MODULES.every((m) => draft.matrix[m].length === 0);

/**
 * «Другие разделы»: what an agent may do in each module beyond tasks/notes/calendar — a table of sections × actions
 * (смотреть / добавлять / менять / удалять). Changing is direct only for a manager (an assistant asks you first); deleting
 * is always a request. Only modules switched on here are offered.
 */
export function ModulePermissionsField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }): React.ReactElement | null {
  const { isEnabled } = useEnabledModules();
  const offered = MODULE_AGENT_PERMISSIONS.filter((item) => isEnabled(item.moduleId as OrionModuleId));
  if (offered.length === 0) return null;
  const rows = [...new Set(offered.map((item) => item.moduleLabel))];
  const actions = ["read", "create", "update", "delete"].filter((action) => offered.some((item) => item.action === action));
  const all = offered.map((item) => item.permission);
  const allOn = all.every((permission) => value.includes(permission));
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 flex w-full items-center gap-2 text-xs text-muted-foreground">
        Другие разделы
        <button type="button" className="text-accent hover:underline" onClick={() => onChange(allOn ? value.filter((p) => !all.includes(p)) : [...new Set([...value, ...all])])}>
          {allOn ? "Снять всё" : "Отметить всё"}
        </button>
      </legend>
      <table className="text-label">
        <thead>
          <tr className="text-2xs text-muted-foreground">
            <th className="pr-4 text-left font-normal" />
            {actions.map((action) => (
              <th key={action} className="px-2 text-center font-normal">{MODULE_PERMISSION_ACTION_LABEL[action] ?? action}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row" className="pr-4 text-left font-normal">{row}</th>
              {actions.map((action) => {
                const item = offered.find((entry) => entry.moduleLabel === row && entry.action === action);
                return (
                  <td key={action} className="px-2 text-center">
                    {item ? (
                      <input
                        type="checkbox"
                        aria-label={item.label}
                        checked={value.includes(item.permission)}
                        onChange={() => onChange(toggled(value, item.permission))}
                        className="accent-accent"
                      />
                    ) : (
                      <span className="text-muted-foreground" title={`${row}: эта операция не предусмотрена для раздела — агенту доступны только отмеченные в строке.`}>·</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

/** Human labels of a token's module permissions, for its card. */
export function describeModulePermissions(permissions: readonly string[]): string {
  return MODULE_AGENT_PERMISSIONS.filter((item) => permissions.includes(item.permission)).map((item) => item.label).join(" · ");
}

const toggled = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function AgentPolicyFields({
  workspaceId,
  draft,
  onChange
}: {
  workspaceId: string | undefined;
  draft: PolicyDraft;
  onChange: (next: PolicyDraft) => void;
}): React.ReactElement {
  const projects = useProjects(workspaceId).data ?? [];
  const set = (patch: Partial<PolicyDraft>): void => onChange({ ...draft, ...patch });
  const setCell = (module: AgentPermissionModule, op: AgentPermissionOp): void =>
    set({ matrix: { ...draft.matrix, [module]: toggled(draft.matrix[module], op) } });

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs text-muted-foreground">Профиль (отправная точка — после можно донастроить вручную)</legend>
        <div className="flex flex-wrap gap-1.5">
          {AGENT_POLICY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => onChange(preset.apply(draft))}
              className="rounded-full border border-border px-2.5 py-1 text-label text-muted-foreground hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="max-w-xs space-y-1">
        <span className="text-xs text-muted-foreground">Режим автономности</span>
        <ChoiceSelect
          label="Режим автономности"
          value={draft.mode}
          options={AGENT_MODES.map((mode) => ({ value: mode, label: AGENT_MODE_LABEL[mode] }))}
          onChange={(mode) => set({ mode })}
        />
        <span className="text-2xs text-muted-foreground">{AGENT_MODE_HINT[draft.mode]}</span>
      </div>

      {draft.mode === "admin" ? (
        <p className="rounded-md border border-warning/30 bg-warning/[0.06] px-3 py-2 text-label text-warning">
          В режиме «Администратор» матрица прав и список модулей ниже не нужны и не проверяются — токен может всё, в
          любом подключённом модуле. Единственное, что всё ещё действует — галочки «Запреты» ниже, если вы их поставите.
        </p>
      ) : (
        <>
          <fieldset>
            <legend className="mb-1 text-xs text-muted-foreground">Права по разделам (режим может их только сузить)</legend>
            <table className="text-label">
              <thead>
                <tr className="text-2xs text-muted-foreground">
                  <th className="pr-4 text-left font-normal" />
                  {AGENT_PERMISSION_OPS.map((op) => (
                    <th key={op} className="px-2 text-center font-normal">{AGENT_PERMISSION_OP_LABEL[op]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AGENT_PERMISSION_MODULES.map((module) => (
                  <tr key={module}>
                    <th scope="row" className="pr-4 text-left font-normal">{AGENT_PERMISSION_MODULE_LABEL[module]}</th>
                    {AGENT_PERMISSION_OPS.map((op) => (
                      <td key={op} className="px-2 text-center">
                        {OPS_FOR[module].includes(op) ? (
                          <input
                            type="checkbox"
                            aria-label={`${AGENT_PERMISSION_MODULE_LABEL[module]}: ${AGENT_PERMISSION_OP_LABEL[op].toLowerCase()}`}
                            checked={draft.matrix[module].includes(op)}
                            onChange={() => setCell(module, op)}
                            className="accent-accent"
                          />
                        ) : (
                          <span className="text-muted-foreground" title={OP_UNAVAILABLE_REASON[module] ?? "Эта операция не предусмотрена для этого раздела."}>·</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-2xs text-muted-foreground">
              «Менять» — править существующее; «Предлагать» — просить вас подтвердить (изменение или удаление). В режиме помощника любое изменение идёт через подтверждение.
            </p>
          </fieldset>

          <ModulePermissionsField value={draft.modulePermissions} onChange={(modulePermissions) => set({ modulePermissions })} />
        </>
      )}

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 text-xs text-muted-foreground">Взаимодействие агентов</legend>
        {EXTRA_SCOPES.map((scope) => (
          <label key={scope} className="flex items-center gap-1.5 text-label">
            <input type="checkbox" checked={draft.extraScopes.includes(scope)} onChange={() => set({ extraScopes: toggled(draft.extraScopes, scope) })} className="accent-accent" />
            {AGENT_SCOPE_LABEL[scope]}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 text-xs text-muted-foreground">Запреты (проверяются на сервере)</legend>
        {AGENT_FORBIDDEN.map((flag) => (
          <label key={flag} className="flex items-center gap-1.5 text-label">
            <input type="checkbox" checked={draft.forbidden.includes(flag)} onChange={() => set({ forbidden: toggled(draft.forbidden, flag) })} className="accent-accent" />
            {AGENT_FORBIDDEN_LABEL[flag]}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Лимит записей в час (пусто — без лимита)</span>
        <input
          type="number"
          min={1}
          max={10000}
          value={draft.writeLimit}
          onChange={(e) => set({ writeLimit: e.target.value })}
          className="w-32 rounded-md border border-border bg-background px-2 py-1 text-label"
        />
      </label>

      {projects.length > 0 ? (
        <>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs text-muted-foreground">Только эти проекты (ничего не выбрано — все)</legend>
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-label">
                <input type="checkbox" checked={draft.allowedProjectIds.includes(p.id)} onChange={() => set({ allowedProjectIds: toggled(draft.allowedProjectIds, p.id) })} className="accent-accent" />
                {p.name}
              </label>
            ))}
          </fieldset>
          {draft.mode === "manager" ? (
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
              <legend className="mb-1 text-xs text-muted-foreground">
                Автофиксировать явно принятые решения (заметки с тегом «решение») в проектах — по умолчанию выключено
              </legend>
              {projects.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-label">
                  <input type="checkbox" checked={draft.autoCommitProjectIds.includes(p.id)} onChange={() => set({ autoCommitProjectIds: toggled(draft.autoCommitProjectIds, p.id) })} className="accent-accent" />
                  {p.name}
                </label>
              ))}
            </fieldset>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
