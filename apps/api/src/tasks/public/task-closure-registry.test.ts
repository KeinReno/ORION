import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { TaskClosureRegistry } from "./task-closure-registry";

describe("Task closure contract", () => {
  it("works without installed neighbors and rejects duplicate owners", async () => {
    const registry = new TaskClosureRegistry();
    const tx = {} as Prisma.TransactionClient;
    await registry.closeTx(tx, { workspaceId: "w", taskId: "t" });
    registry.register("time", async () => {});
    expect(() => registry.register("time", async () => {})).toThrow("Duplicate task-closure owner");
    registry.unregister("time");
    registry.register("time", async () => {});
  });

  it("awaits each owner in the caller's transaction and aborts later handlers on failure", async () => {
    const registry = new TaskClosureRegistry();
    const tx = {} as Prisma.TransactionClient;
    const closure = { workspaceId: "w", taskId: "t" };
    const calls: string[] = [];
    const failure = new Error("bridge failed");
    registry.register("first", async (actualTx, actualClosure) => {
      expect(actualTx).toBe(tx);
      expect(actualClosure).toBe(closure);
      await Promise.resolve();
      calls.push("first finished");
    });
    registry.register("second", async () => { calls.push("second"); throw failure; });
    registry.register("later", async () => { calls.push("must not run"); });
    await expect(registry.closeTx(tx, closure)).rejects.toBe(failure);
    expect(calls).toEqual(["first finished", "second"]);
  });
});
