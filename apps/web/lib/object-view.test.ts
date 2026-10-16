import { describe, expect, it } from "vitest";
import { objectViewPanel } from "./object-view";
import { type SearchableEntityType, type ViewRef } from "@orion/shared-types";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";
const ref = (entityType: SearchableEntityType, viewId = "detail"): ViewRef => ({ object: { workspaceId, entityType, entityId }, viewId });

describe("explicit object views", () => {
  it("addresses existing standalone editors and project views without copying records", () => {
    for (const type of ["task", "note", "project", "list", "document"] as const) expect(objectViewPanel(ref(type), workspaceId)).toBe(`${type}:${entityId}`);
    expect(objectViewPanel(ref("project", "materials"), workspaceId)).toBe(`projectmaterials:${entityId}`);
    expect(objectViewPanel(ref("project", "plan"), workspaceId)).toBe(`projectplan:${entityId}`);
  });
  it("rejects foreign workspace and unsupported views instead of using the active workspace silently", () => {
    expect(objectViewPanel(ref("note"), entityId)).toBeNull();
    expect(objectViewPanel(ref("note"), null)).toBeNull();
    for (const view of ["missing", "constructor", "toString", "__proto__"]) expect(objectViewPanel(ref("project", view), workspaceId)).toBeNull();
    expect(objectViewPanel(ref("event"), workspaceId)).toBeNull();
    expect(objectViewPanel(ref("note", "plan"), workspaceId)).toBeNull();
  });
  it("validates persisted/untrusted addresses and does not accept injected panel syntax", () => {
    expect(objectViewPanel({ ...ref("task"), object: { ...ref("task").object, entityId: "other:panel" } }, workspaceId)).toBeNull();
    expect(objectViewPanel({ ...ref("task"), filters: {} } as ViewRef, workspaceId)).toBeNull();
  });
});
