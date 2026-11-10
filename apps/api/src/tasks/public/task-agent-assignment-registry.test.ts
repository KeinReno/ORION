import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { TaskAgentAssignmentRegistry } from "./task-agent-assignment-registry";

describe("TaskAgentAssignmentRegistry", () => {
  it("allows human assignment when no optional module claims the task", async () => {
    const registry = new TaskAgentAssignmentRegistry();
    registry.register("agent-hub", vi.fn().mockResolvedValue(false));
    await expect(registry.assertHumanAssignmentAllowedTx({} as never, { workspaceId: "w1", taskId: "t1" })).resolves.toBeUndefined();
  });

  it("rejects human assignment when Agent Hub already owns the executor slot", async () => {
    const registry = new TaskAgentAssignmentRegistry();
    const check = vi.fn().mockResolvedValue(true);
    registry.register("agent-hub", check);
    await expect(registry.assertHumanAssignmentAllowedTx({} as never, { workspaceId: "w1", taskId: "t1" }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(check).toHaveBeenCalledOnce();
  });

  it("unregisters an optional owner without affecting the Tasks host", async () => {
    const registry = new TaskAgentAssignmentRegistry();
    registry.register("agent-hub", vi.fn().mockResolvedValue(true));
    registry.unregister("agent-hub");
    await expect(registry.assertHumanAssignmentAllowedTx({} as never, { workspaceId: "w1", taskId: "t1" })).resolves.toBeUndefined();
  });
});
