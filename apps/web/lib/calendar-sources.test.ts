import { describe, expect, it } from "vitest";
import type { PlanningBlock } from "@orion/shared-types";
import { BLOCK_ITEM_PREFIX, blockItems } from "./calendar-sources";

function block(over: Partial<PlanningBlock> = {}): PlanningBlock {
  return {
    id: "blk-1",
    workspaceId: "ws-1",
    taskId: "task-9",
    projectId: null,
    title: "Фокус: отчёт",
    note: "",
    type: "focus",
    state: "committed",
    startAt: "2026-11-17T09:00:00.000Z",
    endAt: "2026-11-17T11:00:00.000Z",
    revision: 1,
    clientMutationId: null,
    conflicts: [],
    createdAt: "2026-11-17T08:00:00.000Z",
    updatedAt: "2026-11-17T08:00:00.000Z",
    ...over
  };
}

describe("blockItems (P3-2: тайм-блоки планирования на календаре)", () => {
  it("maps a block onto a read-only planning CalendarItem with the block prefix", () => {
    const [item] = blockItems([block()]);
    expect(item).toEqual({
      id: `${BLOCK_ITEM_PREFIX}blk-1`,
      start: "2026-11-17T09:00:00.000Z",
      end: "2026-11-17T11:00:00.000Z",
      label: "Фокус: отчёт",
      tone: "__planning__",
      kind: "planning",
      readOnly: true
    });
  });

  it("tolerates undefined (module off or source toggled off)", () => {
    expect(blockItems(undefined)).toEqual([]);
  });
});
