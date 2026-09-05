import { describe, expect, it } from "vitest";
import { createTaskInputSchema, taskStatusSchema, updateTaskInputSchema } from "./task";
import { createNoteInputSchema } from "./note";
import { authResponseSchema, refreshInputSchema, registerInputSchema } from "./auth";

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

  it("only allows the three known statuses", () => {
    expect(taskStatusSchema.options).toEqual(["todo", "in_progress", "done"]);
    expect(taskStatusSchema.safeParse("archived").success).toBe(false);
  });

  it("update schema keeps every field optional", () => {
    expect(updateTaskInputSchema.parse({})).toEqual({});
    expect(updateTaskInputSchema.safeParse({ status: "in_progress" }).success).toBe(true);
  });
});

describe("note schema", () => {
  it("defaults body to an empty string", () => {
    expect(createNoteInputSchema.parse({ title: "note" }).body).toBe("");
  });
});

describe("auth schemas", () => {
  it("register requires an 8+ char password and a valid email", () => {
    expect(
      registerInputSchema.safeParse({ email: "a@b.co", password: "short", name: "A" }).success
    ).toBe(false);
    expect(
      registerInputSchema.safeParse({ email: "not-email", password: "longenough", name: "A" }).success
    ).toBe(false);
    expect(
      registerInputSchema.safeParse({ email: "a@b.co", password: "longenough", name: "A" }).success
    ).toBe(true);
  });

  it("refresh input rejects an empty token", () => {
    expect(refreshInputSchema.safeParse({ refreshToken: "" }).success).toBe(false);
  });

  it("auth response requires both tokens and a user", () => {
    const ok = {
      accessToken: "a",
      refreshToken: "r",
      user: { id: "1", email: "a@b.co", name: "A" }
    };
    expect(authResponseSchema.safeParse(ok).success).toBe(true);
    expect(authResponseSchema.safeParse({ ...ok, refreshToken: undefined }).success).toBe(false);
  });
});
