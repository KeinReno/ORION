import { describe, expect, it } from "vitest";
import { createTaskInputSchema, isTaskClosed, TASK_CLOSED_STATUSES, taskStatusSchema, updateTaskInputSchema } from "./task";
import { createNoteInputSchema } from "./note";
import { authResponseSchema, loginInputSchema, refreshInputSchema, registerInputSchema } from "./auth";

// The zod schemas in this package are the single source of truth for the
// API contract (backend ZodValidationPipe, frontend ApiClient response
// parsing). These lock the acceptance/rejection edges the rest of the
// codebase relies on.

describe("task schemas", () => {
  it("defaults description to an empty string", () => {
    const parsed = createTaskInputSchema.parse({ title: "Ship v0.4" });
    expect(parsed.description).toBe("");
  });

  it("rejects an empty title", () => {
    expect(createTaskInputSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("accepts a null dueAt but rejects a non-ISO string", () => {
    expect(createTaskInputSchema.safeParse({ title: "x", dueAt: null }).success).toBe(true);
    expect(createTaskInputSchema.safeParse({ title: "x", dueAt: "not-a-date" }).success).toBe(false);
  });

  it("only allows the five known statuses", () => {
    expect(taskStatusSchema.options).toEqual(["backlog", "todo", "in_progress", "done", "canceled"]);
    expect(taskStatusSchema.safeParse("archived").success).toBe(false);
  });

  it("update schema keeps every field optional", () => {
    expect(updateTaskInputSchema.parse({})).toEqual({});
    expect(updateTaskInputSchema.safeParse({ status: "in_progress" }).success).toBe(true);
  });

  it("treats done and canceled as closed, everything else as open", () => {
    // Every "is it still actionable" decision in the codebase goes through
    // this helper — before it existed, six call sites compared against
    // "done" by hand and counted canceled tasks as overdue.
    expect(isTaskClosed("done")).toBe(true);
    expect(isTaskClosed("canceled")).toBe(true);
    for (const status of ["backlog", "todo", "in_progress"] as const) {
      expect(isTaskClosed(status)).toBe(false);
    }
    expect(TASK_CLOSED_STATUSES).toEqual(["done", "canceled"]);
  });
});

describe("note schema", () => {
  it("defaults body to an empty string", () => {
    expect(createNoteInputSchema.parse({ title: "note" }).body).toBe("");
  });
});

describe("auth schemas", () => {
  it("register accepts name+password without email, or a PIN", () => {
    expect(registerInputSchema.safeParse({ name: "A", password: "short" }).success).toBe(false);
    expect(registerInputSchema.safeParse({ name: "A", password: "longenough" }).success).toBe(true);
    expect(registerInputSchema.safeParse({ name: "A", pin: "1234" }).success).toBe(true);
    expect(registerInputSchema.safeParse({ name: "A", pin: "12" }).success).toBe(false);
    expect(registerInputSchema.safeParse({ name: "A", email: "not-email", password: "longenough" }).success).toBe(false);
    expect(registerInputSchema.safeParse({ name: "A", email: "a@b.co", password: "longenough" }).success).toBe(true);
  });

  it("login accepts a userId or the legacy email field", () => {
    expect(loginInputSchema.safeParse({ userId: "u1", password: "1" }).success).toBe(true);
    expect(loginInputSchema.safeParse({ email: "1", password: "1" }).success).toBe(true);
    expect(loginInputSchema.safeParse({ userId: "u1", pin: "1234" }).success).toBe(true);
    expect(loginInputSchema.safeParse({ email: "  ", password: "1" }).success).toBe(false);
  });

  it("refresh input rejects an empty token", () => {
    expect(refreshInputSchema.safeParse({ refreshToken: "" }).success).toBe(false);
  });

  it("auth response requires both tokens and a complete user", () => {
    const user = {
      id: "1",
      email: "a@b.co",
      name: "A",
      unlockKind: "password" as const,
      hasAvatar: false,
      passwordStrength: 2,
      passwordChangedAt: null
    };
    const ok = { accessToken: "a", refreshToken: "r", user };
    expect(authResponseSchema.safeParse(ok).success).toBe(true);
    expect(authResponseSchema.safeParse({ ...ok, refreshToken: undefined }).success).toBe(false);
    // The password fields are part of the contract, not optional extras —
    // dropping them must fail loudly instead of being defaulted away.
    expect(authResponseSchema.safeParse({ ...ok, user: { id: "1", email: "a@b.co", name: "A" } }).success).toBe(false);
  });
});
