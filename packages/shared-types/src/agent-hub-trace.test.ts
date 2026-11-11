import { describe, expect, it } from "vitest";
import { buildAgentHubTraceTree, flattenAgentHubTraceTree, type AgentHubTraceStep } from "./agent-hub-trace";

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 11, 12, minute)).toISOString();

function step(stepId: string, parentStepId: string | null, minute: number, type: AgentHubTraceStep["type"] = "tool_call"): AgentHubTraceStep {
  return {
    id: `row-${stepId}`, workspaceId: "ws", executionId: "run", stepId, parentStepId,
    type, name: null, agentId: null, actorId: "token", payload: {},
    durationMs: null, error: null, attempt: 0, at: at(minute)
  };
}

describe("Agent Hub trace tree", () => {
  const call = step("call-1", null, 0, "tool_call");
  const result = step("result-1", "call-1", 1, "tool_result");
  const note = step("note-1", "result-1", 2, "note");
  const delegation = step("delegation-1", null, 3, "delegation");
  const all = [call, result, note, delegation];

  it("nests tool_result under its tool_call and keeps chronological order", () => {
    const tree = buildAgentHubTraceTree(all);
    expect(tree.map(node => node.stepId)).toEqual(["call-1", "delegation-1"]);
    expect(tree[0]!.children.map(node => node.stepId)).toEqual(["result-1"]);
    expect(tree[0]!.children[0]!.children.map(node => node.stepId)).toEqual(["note-1"]);
    expect(flattenAgentHubTraceTree(tree).map(item => item.stepId)).toEqual(["call-1", "result-1", "note-1", "delegation-1"]);
  });

  it("limits depth without dropping the roots", () => {
    expect(buildAgentHubTraceTree(all, { depth: 0 }).map(node => node.children)).toEqual([[], []]);
    const one = buildAgentHubTraceTree(all, { depth: 1 });
    expect(one[0]!.children.map(node => node.stepId)).toEqual(["result-1"]);
    expect(one[0]!.children[0]!.children).toEqual([]);
  });

  it("focuses one subtree by stepId", () => {
    const tree = buildAgentHubTraceTree(all, { rootStepId: "result-1" });
    expect(tree.map(node => node.stepId)).toEqual(["result-1"]);
    expect(tree[0]!.children.map(node => node.stepId)).toEqual(["note-1"]);
    expect(buildAgentHubTraceTree(all, { rootStepId: "missing" })).toEqual([]);
  });

  it("promotes orphans to roots and cuts cycles instead of looping", () => {
    const orphan = step("orphan", "not-selected", 4);
    expect(buildAgentHubTraceTree([orphan]).map(node => node.stepId)).toEqual(["orphan"]);
    const a = step("a", "b", 5);
    const b = step("b", "a", 6);
    const tree = buildAgentHubTraceTree([a, b]);
    expect(tree).toHaveLength(0);
    const rooted = buildAgentHubTraceTree([a, b], { rootStepId: "a" });
    expect(rooted.map(node => node.stepId)).toEqual(["a"]);
    expect(rooted[0]!.children.map(node => node.stepId)).toEqual(["b"]);
    expect(rooted[0]!.children[0]!.children).toEqual([]);
  });

  it("drops duplicate step ids deterministically", () => {
    const duplicate = { ...step("call-1", null, 9), name: "later copy" };
    const tree = buildAgentHubTraceTree([call, duplicate]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBeNull();
  });
});
