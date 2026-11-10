import { describe, expect, it } from "vitest";
import { taskAssignmentOptions } from "./task-assignment-options";

const members = [
  { id: "member-me", name: "Я" },
  { id: "member-current", name: "Текущий исполнитель" },
  { id: "member-other", name: "Другой участник" }
];

describe("taskAssignmentOptions", () => {
  it("lets owners and leads choose any workspace member", () => {
    expect(taskAssignmentOptions(members, true, "member-me", "member-current")).toEqual(members);
  });

  it("limits members to self and the current assignee", () => {
    expect(taskAssignmentOptions(members, false, "member-me", "member-current")).toEqual(members.slice(0, 2));
  });

  it("lets an unassigned member self-assign without exposing other members", () => {
    expect(taskAssignmentOptions(members, false, "member-me", null)).toEqual([members[0]]);
  });

  it("offers no member choices when identity is unavailable", () => {
    expect(taskAssignmentOptions(members, false, null, null)).toEqual([]);
  });
});
