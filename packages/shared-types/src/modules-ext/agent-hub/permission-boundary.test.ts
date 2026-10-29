import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../../agent-tools";
import { decideAgentModuleOperation, type AgentPolicySubject } from "../../agent-policy";
import { isRegisteredPermission } from "../../permissions";

function tool(name: string) {
  const item = AGENT_TOOLS.find(candidate => candidate.name === name);
  if (!item) throw new Error("Missing tool: " + name);
  return item;
}

describe("Agent Hub: runtime presence permission isolation", () => {
  const observer: AgentPolicySubject = {
    mode: "assistant",
    scopes: ["tasks:read"],
    permissions: null,
    forbidden: [],
    modulePermissions: ["agent-hub.execution.read", "agent-hub.runtime.create"]
  };

  it("registers a distinct scoped permission for runtime presence", () => {
    expect(isRegisteredPermission("agent-hub.runtime.create")).toBe(true);
    expect(tool("orion_agent_hub_runtime_register").permission).toBe("agent-hub.runtime.create");
    expect(tool("orion_agent_hub_runtime_pulse").permission).toBe("agent-hub.runtime.create");
    expect(tool("orion_agent_hub_runtime_close").permission).toBe("agent-hub.runtime.create");
    expect(tool("orion_agent_hub_claim").permission).toBe("agent-hub.execution.create");
    expect(tool("orion_agent_hub_report").permission).toBe("agent-hub.execution.create");
  });

  it("allows presence creation without granting task execution", () => {
    const runtimePermission = tool("orion_agent_hub_runtime_register").permission!;
    const claimPermission = tool("orion_agent_hub_claim").permission!;
    expect(decideAgentModuleOperation(observer, runtimePermission, "create").kind).toBe("allow");
    expect(decideAgentModuleOperation(observer, claimPermission, "create").kind).toBe("deny");
    expect(decideAgentModuleOperation(observer, "agent-hub.execution.read", "read").kind).toBe("allow");
  });

  it("remains read-only in observer mode despite the runtime-create permission", () => {
    const noWrites: AgentPolicySubject = { ...observer, mode: "observer" };
    expect(decideAgentModuleOperation(noWrites, "agent-hub.runtime.create", "create").kind).toBe("deny");
  });
});
