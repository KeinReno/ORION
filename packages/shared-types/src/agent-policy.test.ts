import { describe, expect, it } from "vitest";
import { agentAuditResultOf, createAgentTokenInputSchema } from "./agent";
import {
  decideAgentModuleOperation,
  decideAgentOperation,
  remoteTokenViolations,
  effectiveAgentPermissions,
  isDecisionNote,
  permissionsFromScopes,
  scopesFromPermissions,
  toCsv,
  type AgentPolicySubject
} from "./agent-policy";

const subject = (over: Partial<AgentPolicySubject>): AgentPolicySubject => ({
  mode: "manager",
  scopes: ["tasks:read", "tasks:write", "notes:read", "notes:write", "finance:draft"],
  permissions: null,
  forbidden: [],
  ...over
});

describe("decideAgentOperation", () => {
  it("наблюдатель читает, но любая запись — отказ", () => {
    const s = subject({ mode: "observer" });
    expect(decideAgentOperation(s, "tasks", "read").kind).toBe("allow");
    for (const op of ["create", "update", "delete", "propose"] as const) expect(decideAgentOperation(s, "tasks", op).kind).toBe("deny");
  });

  it("помощник создаёт сразу, а менять существующее может только предложением", () => {
    const s = subject({ mode: "assistant" });
    expect(decideAgentOperation(s, "tasks", "create").kind).toBe("allow");
    expect(decideAgentOperation(s, "tasks", "update").kind).toBe("propose");
    expect(decideAgentOperation(s, "tasks", "delete").kind).toBe("propose");
  });

  it("менеджер меняет сразу, но удаление — всё равно предложение", () => {
    const s = subject({ mode: "manager" });
    expect(decideAgentOperation(s, "notes", "update").kind).toBe("allow");
    expect(decideAgentOperation(s, "notes", "delete").kind).toBe("propose");
  });

  it("без права «менять» в матрице менеджер превращается в предлагающего", () => {
    const s = subject({ permissions: { tasks: ["read", "create", "propose"] } });
    expect(decideAgentOperation(s, "tasks", "update").kind).toBe("propose");
    expect(decideAgentOperation(s, "tasks", "create").kind).toBe("allow");
  });

  it("матрица сужает скоупы, но не расширяет", () => {
    const s = subject({ scopes: ["tasks:read"], permissions: { tasks: ["read", "create", "update"] } });
    expect(effectiveAgentPermissions(s.scopes, s.permissions).tasks).toEqual(["read"]);
    expect(decideAgentOperation(s, "tasks", "create").kind).toBe("deny");
  });

  it("запрет-флаги сильнее всего остального", () => {
    expect(decideAgentOperation(subject({ forbidden: ["finance"] }), "finance", "create").kind).toBe("deny");
    expect(decideAgentOperation(subject({ forbidden: ["delete"] }), "tasks", "delete").kind).toBe("deny");
    expect(decideAgentOperation(subject({ forbidden: ["delete"] }), "tasks", "update").kind).toBe("allow");
  });

  it("старый токен (matrix = null) ведёт себя как раньше: запись сразу, удаление — запрос", () => {
    const legacy = subject({ mode: "manager", scopes: ["tasks:read", "tasks:write"], permissions: null });
    expect(decideAgentOperation(legacy, "tasks", "update").kind).toBe("allow");
    expect(decideAgentOperation(legacy, "tasks", "delete").kind).toBe("propose");
    expect(decideAgentOperation(legacy, "notes", "read").kind).toBe("deny");
  });
});

describe("матрица ↔ скоупы", () => {
  it("scopesFromPermissions и permissionsFromScopes согласованы", () => {
    const perms = { tasks: ["read", "update"], projects: ["read"], finance: ["create"] } as const;
    const scopes = scopesFromPermissions({ tasks: [...perms.tasks], projects: [...perms.projects], finance: [...perms.finance] });
    expect(scopes.sort()).toEqual(["finance:draft", "projects:read", "tasks:read", "tasks:write"]);
    expect(permissionsFromScopes(["projects:read"]).projects).toEqual(["read"]);
  });
});

describe("схема выпуска токена", () => {
  it("по умолчанию — помощник, старый вход {scopes} остаётся валидным", () => {
    const parsed = createAgentTokenInputSchema.parse({ name: "x", scopes: ["tasks:read"], expiresInDays: 30 });
    expect(parsed.mode).toBe("assistant");
    expect(parsed.allowedProjectIds).toEqual([]);
    expect(parsed.writeLimitPerHour).toBeNull();
  });
  it("без разрешений вообще — отказ; матрица вместо скоупов — ок", () => {
    expect(createAgentTokenInputSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(createAgentTokenInputSchema.safeParse({ name: "x", permissions: { notes: ["read"] } }).success).toBe(true);
  });
});

describe("прочее", () => {
  it("результат из HTTP-статуса", () => {
    expect([200, 202, 403, 401, 429, 500, 404].map(agentAuditResultOf)).toEqual(["ok", "proposed", "denied", "denied", "limited", "error", "error"]);
  });
  it("заметка-решение определяется по тегу", () => {
    expect(isDecisionNote(["#Решение"])).toBe(true);
    expect(isDecisionNote(["идея"])).toBe(false);
  });
  it("CSV экранирует кавычки и формулы", () => {
    expect(toCsv([["a", '=SUM(A1)'], ['x,"y"', null]])).toBe('a,\'=SUM(A1)\r\n"x,""y""",');
  });
});

describe("decideAgentModuleOperation (G13)", () => {
  const read = "pet-care.pet.read";
  const create = "pet-care.pet.create";

  it("без выданного разрешения — отказ, даже читать", () => {
    expect(decideAgentModuleOperation(subject({ modulePermissions: [] }), read, "read")).toMatchObject({ kind: "deny" });
    expect(decideAgentModuleOperation(subject({}), create, "create")).toMatchObject({ kind: "deny" });
    expect(decideAgentModuleOperation(subject({ modulePermissions: [read] }), create, "create")).toMatchObject({ kind: "deny" });
  });

  it("наблюдатель читает, но не пишет; помощник и менеджер создают сразу", () => {
    const granted = [read, create];
    expect(decideAgentModuleOperation(subject({ mode: "observer", modulePermissions: granted }), read, "read")).toEqual({ kind: "allow" });
    expect(decideAgentModuleOperation(subject({ mode: "observer", modulePermissions: granted }), create, "create")).toMatchObject({ kind: "deny" });
    expect(decideAgentModuleOperation(subject({ mode: "assistant", modulePermissions: granted }), create, "create")).toEqual({ kind: "allow" });
    expect(decideAgentModuleOperation(subject({ mode: "manager", modulePermissions: granted }), create, "create")).toEqual({ kind: "allow" });
  });

  it("правка: менеджер сразу, помощник — запрос; удаление — всегда запрос, а при запрете удаления — отказ", () => {
    const update = "habits.habit.update";
    const remove = "habits.habit.delete";
    const granted = [update, remove];
    expect(decideAgentModuleOperation(subject({ mode: "manager", modulePermissions: granted }), update, "update")).toEqual({ kind: "allow" });
    expect(decideAgentModuleOperation(subject({ mode: "assistant", modulePermissions: granted }), update, "update")).toEqual({ kind: "propose" });
    expect(decideAgentModuleOperation(subject({ mode: "observer", modulePermissions: granted }), update, "update")).toMatchObject({ kind: "deny" });
    expect(decideAgentModuleOperation(subject({ mode: "manager", modulePermissions: granted, forbidden: [] }), remove, "delete")).toEqual({ kind: "propose" });
    expect(decideAgentModuleOperation(subject({ mode: "manager", modulePermissions: granted, forbidden: ["delete"] }), remove, "delete")).toMatchObject({ kind: "deny" });
  });
});

describe("remoteTokenViolations (ADR-0017)", () => {
  it("токен на сервере: помощник со сроком ≤ 30 дней и запретом удаления допустим", () => {
    expect(remoteTokenViolations({ mode: "assistant", expiresInDays: 30, forbidden: ["delete"] })).toEqual([]);
    expect(remoteTokenViolations({ mode: "observer", expiresInDays: 1, forbidden: ["delete", "finance"] })).toEqual([]);
  });

  it("менеджер, бессрочный или долгий токен и снятый запрет удаления — нарушения", () => {
    expect(remoteTokenViolations({ mode: "manager", expiresInDays: 7, forbidden: ["delete"] })).toHaveLength(1);
    expect(remoteTokenViolations({ mode: "assistant", expiresInDays: null, forbidden: ["delete"] })[0]).toContain("30 дней");
    expect(remoteTokenViolations({ mode: "assistant", expiresInDays: 31, forbidden: ["delete"] })).toHaveLength(1);
    expect(remoteTokenViolations({ mode: "assistant", expiresInDays: 7, forbidden: [] })[0]).toContain("запрет удаления");
    expect(remoteTokenViolations({ mode: "manager", expiresInDays: null, forbidden: [] })).toHaveLength(3);
  });

  it("при обновлении срок не проверяется", () => {
    expect(remoteTokenViolations({ mode: "assistant", forbidden: ["delete"] }, false)).toEqual([]);
  });
});
