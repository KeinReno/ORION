"use client";

import { useProjects } from "@orion/core-react";
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
  type OrionModuleId,
  type AgentForbidden,
  type AgentMode,
  type AgentPermissionModule,
  type AgentPermissionOp,
  type AgentPermissions,
  type AgentScope,
  type CreateAgentTokenInput
} from "@orion/shared-types";
import { Select } from "@orion/ui";
import { useEnabledModules } from "../../lib/use-enabled-modules";

/** Non-matrix scopes: agent-to-agent traffic and links. */
const EXTRA_SCOPES: AgentScope[] = ["agents:message", "agents:delegate"];

/** Which ops make sense per module: projects are read-only, finance only ever produces drafts a human confirms. */
const OPS_FOR: Record<AgentPermissionModule, AgentPermissionOp[]> = {
  tasks: ["read", "create", "update", "propose"],
  notes: ["read", "create", "update", "propose"],
  events: ["read", "create", "update", "propose"],
  projects: ["read"],
  finance: ["create"]
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

/** True when the matrix grants nothing and no extra scope is ticked: the server would refuse it. */
export const policyIsEmpty = (draft: PolicyDraft): boolean =>
  draft.extraScopes.length === 0 && draft.modulePermissions.length === 0 && AGENT_PERMISSION_MODULES.every((m) => draft.matrix[m].length === 0);

/**
 * «Другие модули»: what an agent may do in habits, lists, time, contacts, documents, finance (read only), inventory and
 * modules added by manifest. Only modules switched on here are offered; a ticked permission of a module switched off
 * later simply answers 409 until it is back.
 */
export function ModulePermissionsField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }): React.ReactElement | null {
  const { isEnabled } = useEnabledModules();
  const offered = MODULE_AGENT_PERMISSIONS.filter((item) => isEnabled(item.moduleId as OrionModuleId));
  if (offered.length === 0) return null;
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
      <legend className="mb-1 text-xs text-muted-foreground">Другие модули</legend>
      {offered.map((item) => (
        <label key={item.permission} className="flex items-center gap-1.5 text-label">
          <input
            type="checkbox"
            checked={value.includes(item.permission)}
            onChange={() => onChange(toggled(value, item.permission))}
            className="accent-accent"
          />
          {item.label}
        </label>
      ))}
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
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Режим автономности</span>
        <Select value={draft.mode} onChange={(e) => set({ mode: e.target.value as AgentMode })} className="w-auto">
          {AGENT_MODES.map((mode) => (
            <option key={mode} value={mode}>{AGENT_MODE_LABEL[mode]}</option>
          ))}
        </Select>
        <span className="text-2xs text-muted-foreground">{AGENT_MODE_HINT[draft.mode]}</span>
      </label>

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
                      <span className="text-muted-foreground">·</span>
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
