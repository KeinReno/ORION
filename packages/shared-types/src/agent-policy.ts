import {
  AGENT_PERMISSION_MODULES,
  type AgentForbidden,
  type AgentMode,
  type AgentPermissionModule,
  type AgentPermissionOp,
  type AgentPermissions,
  type AgentScope
} from "./agent";

/**
 * Permission policy of an agent token (docs/tz/TZ-03). Pure and shared: the server decides with it, the settings
 * screen shows the same answer. Order of authority: forbidden flags → matrix (∩ scopes) → mode. Each step can only
 * take rights away; none adds any.
 */

/** The matrix a flat scope list implies — exactly what a token issued before the matrix could already do. */
export function permissionsFromScopes(scopes: readonly AgentScope[]): Required<AgentPermissions> {
  const has = (scope: AgentScope): boolean => scopes.includes(scope);
  const writeOps = (write: boolean): AgentPermissionOp[] => (write ? ["create", "update", "propose"] : []);
  return {
    tasks: [...(has("tasks:read") ? (["read"] as const) : []), ...writeOps(has("tasks:write"))],
    notes: [...(has("notes:read") ? (["read"] as const) : []), ...writeOps(has("notes:write"))],
    events: [...(has("events:read") ? (["read"] as const) : []), ...writeOps(has("events:write"))],
    projects: has("projects:read") ? ["read"] : [],
    finance: has("finance:draft") ? ["create"] : []
  };
}

/** The scopes a matrix needs. Any write op of a module needs its `:write` scope; `finance` is drafts only. */
export function scopesFromPermissions(permissions: AgentPermissions): AgentScope[] {
  const out = new Set<AgentScope>();
  const ops = (m: AgentPermissionModule): readonly AgentPermissionOp[] => permissions[m] ?? [];
  const writes = (m: AgentPermissionModule): boolean => ops(m).some((op) => op !== "read");
  if (ops("tasks").includes("read")) out.add("tasks:read");
  if (writes("tasks")) out.add("tasks:write");
  if (ops("notes").includes("read")) out.add("notes:read");
  if (writes("notes")) out.add("notes:write");
  if (ops("events").includes("read")) out.add("events:read");
  if (writes("events")) out.add("events:write");
  if (ops("projects").includes("read")) out.add("projects:read");
  if (writes("finance")) out.add("finance:draft");
  return [...out];
}

/**
 * Effective matrix = what the scopes allow, narrowed by the stored matrix (if any). `null` matrix = a legacy token:
 * the scopes alone decide.
 */
export function effectiveAgentPermissions(scopes: readonly AgentScope[], stored: AgentPermissions | null): Required<AgentPermissions> {
  const base = permissionsFromScopes(scopes);
  if (!stored) return base;
  const out = {} as Required<AgentPermissions>;
  for (const module of AGENT_PERMISSION_MODULES) {
    const allowed = new Set(stored[module] ?? []);
    out[module] = base[module].filter((op) => allowed.has(op));
  }
  return out;
}

export type AgentOperation = "read" | "create" | "update" | "delete" | "propose";

export interface AgentPolicySubject {
  mode: AgentMode;
  scopes: readonly AgentScope[];
  permissions: AgentPermissions | null;
  forbidden: readonly AgentForbidden[];
  /** Разрешения реестра для инструментов подключаемых модулей (G13); нет поля = нет таких разрешений. */
  modulePermissions?: readonly string[];
}

export type AgentDecision = { kind: "allow" } | { kind: "propose" } | { kind: "deny"; reason: string };

const deny = (reason: string): AgentDecision => ({ kind: "deny", reason });

/**
 * What happens when this token tries `op` on `module`:
 * - `allow`   — do it now;
 * - `propose` — do not do it, file a request a human approves (deleting always lands here);
 * - `deny`    — 403 with the reason.
 */
export function decideAgentOperation(subject: AgentPolicySubject, module: AgentPermissionModule, op: AgentOperation): AgentDecision {
  if (module === "finance" && subject.forbidden.includes("finance")) return deny("Финансы запрещены для этого токена");
  if (op === "delete" && subject.forbidden.includes("delete")) return deny("Удаление запрещено для этого токена");
  // admin: everything the matrix would otherwise gate is allowed at once — the two explicit
  // forbidden-flag denials above are the only thing this mode still respects (see agent.ts).
  if (subject.mode === "admin") return { kind: "allow" };

  const granted = new Set(effectiveAgentPermissions(subject.scopes, subject.permissions)[module]);
  if (op === "read") return granted.has("read") ? { kind: "allow" } : deny("У токена нет права читать этот раздел");
  if (subject.mode === "observer") return deny("Режим «наблюдатель»: запись запрещена");

  switch (op) {
    case "create":
      return granted.has("create") ? { kind: "allow" } : deny("У токена нет права создавать в этом разделе");
    case "update": {
      if (!granted.has("update") && !granted.has("propose")) return deny("У токена нет права менять в этом разделе");
      // The assistant never changes what exists; the manager does only with a real `update` grant.
      if (subject.mode === "manager" && granted.has("update")) return { kind: "allow" };
      return { kind: "propose" };
    }
    case "delete":
    case "propose":
      return granted.has("propose") || granted.has("update") ? { kind: "propose" } : deny("У токена нет права предлагать в этом разделе");
  }
}

/**
 * A module tool (G13): reading needs only the permission; adding is refused to an observer; changing an existing record
 * is done at once only by a manager, an assistant files a request for the human; deleting is ALWAYS a request, and
 * refused outright when the token forbids deletion.
 */
export function decideAgentModuleOperation(subject: AgentPolicySubject, permission: string, op: "read" | "create" | "update" | "delete"): AgentDecision {
  if (op === "delete" && subject.forbidden?.includes("delete")) return deny("Этому агенту удаление запрещено");
  // admin: doesn't need `permission` granted at all — same short-circuit as decideAgentOperation.
  if (subject.mode === "admin") return { kind: "allow" };
  if (!subject.modulePermissions?.includes(permission)) return deny(`У токена нет разрешения «${permission}»`);
  if (op === "read") return { kind: "allow" };
  if (subject.mode === "observer") return deny("Режим «наблюдатель»: запись запрещена");
  if (op === "create") return { kind: "allow" };
  if (op === "delete") return { kind: "propose" };
  return subject.mode === "manager" ? { kind: "allow" } : { kind: "propose" };
}

/**
 * Legacy compatibility helper. Server location alone must not change the owner's
 * explicitly selected agent mode, forbidden flags or lifetime.
 * Access is instead checked against current workspace membership, token expiry,
 * revocation and the user's chosen per-token permissions.
 * @deprecated Node mode no longer imposes additional token policy.
 */
export function remoteTokenViolations(
  _token: { mode: AgentMode; expiresInDays?: number | null; forbidden: readonly AgentForbidden[] },
  _checkExpiry = true
): string[] {
  return [];
}

/** Short Russian sentence for a matrix cell set, used in the settings list. */
export function describeAgentPermissions(permissions: Required<AgentPermissions>, labels: Record<AgentPermissionModule, string>, opLabels: Record<AgentPermissionOp, string>): string {
  const parts = AGENT_PERMISSION_MODULES.filter((m) => permissions[m].length > 0).map(
    (m) => `${labels[m]}: ${permissions[m].map((op) => opLabels[op].toLowerCase()).join(", ")}`
  );
  return parts.length > 0 ? parts.join(" · ") : "ничего не разрешено";
}

/** An agent-saved note counts as an explicit decision when it carries one of these tags (case-insensitive). */
export const AGENT_DECISION_TAGS = ["решение", "decision"] as const;
export function isDecisionNote(tags: readonly string[] | undefined): boolean {
  return (tags ?? []).some((tag) => (AGENT_DECISION_TAGS as readonly string[]).includes(tag.trim().toLowerCase().replace(/^#/, "")));
}

/** CSV with a formula-injection guard: a cell that would start a spreadsheet formula gets a leading apostrophe. */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  const cell = (value: string | number | null): string => {
    let text = value === null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
