import { entityRefOf } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import {
  INITIAL_RESOURCE_CONTEXT,
  contextHeading,
  describeContext,
  pinContext,
  publishEntity,
  resetContext,
  resolveContext,
  setActivePanel,
  switchWorkspace,
  unpinContext,
  type ResourceContextState,
  type SectionInfo
} from "./resource-context";

const sections: Record<string, SectionInfo> = {
  finance: { panelId: "finance", moduleId: "finance", label: "Финансы" },
  tasks: { panelId: "tasks", moduleId: "tasks", label: "Задачи" }
};
const sectionOf = (id: string): SectionInfo | null => sections[id] ?? null;
const account = { ref: entityRefOf("account", "a1"), title: "Сбер" };

function start(): ResourceContextState {
  return switchWorkspace(setActivePanel(INITIAL_RESOURCE_CONTEXT, "finance"), "w1");
}

describe("resource context (ADR-0014)", () => {
  it("falls back to the section, and is empty with no active panel", () => {
    expect(resolveContext(INITIAL_RESOURCE_CONTEXT, sectionOf)).toBeNull();
    expect(resolveContext(start(), sectionOf)).toEqual({ kind: "section", panelId: "finance", moduleId: "finance", label: "Финансы" });
  });

  it("an object the active panel published narrows the context; other panels' objects do not leak", () => {
    let state = publishEntity(start(), "finance", account);
    expect(resolveContext(state, sectionOf)).toMatchObject({ kind: "entity", title: "Сбер", sectionLabel: "Финансы" });
    state = setActivePanel(state, "tasks");
    expect(resolveContext(state, sectionOf)).toMatchObject({ kind: "section", label: "Задачи" });
  });

  it("a pin wins over the active panel until it is released", () => {
    let state = pinContext(publishEntity(start(), "finance", account), resolveContext(publishEntity(start(), "finance", account), sectionOf));
    state = setActivePanel(state, "tasks");
    expect(resolveContext(state, sectionOf)).toMatchObject({ kind: "entity", title: "Сбер" });
    expect(resolveContext(unpinContext(state), sectionOf)).toMatchObject({ kind: "section", label: "Задачи" });
  });

  it("reset forgets the object and the pin", () => {
    const published = publishEntity(start(), "finance", account);
    const pinned = pinContext(published, resolveContext(published, sectionOf));
    const reset = resetContext(pinned);
    expect(reset.pinned).toBeNull();
    expect(resolveContext(reset, sectionOf)).toMatchObject({ kind: "section" });
  });

  it("publishing the same object again keeps the same state (no render churn)", () => {
    const once = publishEntity(start(), "finance", account);
    expect(publishEntity(once, "finance", { ...account })).toBe(once);
    expect(publishEntity(once, "tasks", null)).toBe(once);
  });

  it("switching workspace clears objects and the pin and explains a dropped pin", () => {
    const published = publishEntity(start(), "finance", account);
    const pinned = pinContext(published, resolveContext(published, sectionOf));
    const next = switchWorkspace(pinned, "w2");
    expect(next.published).toEqual({});
    expect(next.pinned).toBeNull();
    expect(next.notice).toMatch(/закрепление снято/);
    expect(switchWorkspace(start(), "w2").notice).toBeNull();
    expect(switchWorkspace(next, "w2")).toBe(next);
  });

  it("names the context in the header", () => {
    const entity = resolveContext(publishEntity(start(), "finance", account), sectionOf)!;
    expect(contextHeading(entity)).toEqual({ title: "Сбер", subtitle: "Финансы" });
    expect(describeContext(entity, "счёт")).toBe("Финансы → счёт «Сбер»");
    expect(describeContext({ kind: "section", panelId: "finance", moduleId: "finance", label: "Финансы" })).toBe("Финансы");
  });
});
