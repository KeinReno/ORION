import type { ContactCard } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { birthdayItems, contactIdFromBirthdayItem } from "./calendar-sources";

function contact(overrides: Partial<ContactCard> & { id: string; name: string }): ContactCard {
  return {
    workspaceId: "ws",
    homeId: null,
    kind: "person",
    organization: "",
    role: "",
    phone: "",
    email: "",
    phones: [],
    emails: [],
    links: [],
    address: "",
    birthday: null,
    tags: [],
    favorite: false,
    contactEveryDays: null,
    lastContactedAt: null,
    archivedAt: null,
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("birthdayItems", () => {
  const range = { from: "2026-09-28T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" };

  it("puts a birthday on its date as an all-day UTC-midnight pill, with the age", () => {
    const [item] = birthdayItems([contact({ id: "abc-def", name: "Анна", birthday: "1990-10-18" })], range);
    expect(item).toMatchObject({ id: "birthday-abc-def-2026", start: "2026-10-18T00:00:00.000Z", allDay: true, kind: "birthday", readOnly: true, label: "🎂 Анна · 36" });
    expect(contactIdFromBirthdayItem(item?.id ?? "")).toBe("abc-def");
  });

  it("omits the age for an unknown year, skips archived and repeats across a year boundary", () => {
    const wide = { from: "2026-12-20T00:00:00.000Z", to: "2027-01-20T00:00:00.000Z" };
    const items = birthdayItems(
      [
        contact({ id: "a", name: "Без года", birthday: "1904-01-05" }),
        contact({ id: "b", name: "Архив", birthday: "1990-01-06", archivedAt: "2026-02-01T00:00:00.000Z" }),
        contact({ id: "c", name: "Декабрь", birthday: "1980-12-25" })
      ],
      wide
    );
    expect(items.map((item) => [item.label, item.start])).toEqual(
      expect.arrayContaining([
        ["🎂 Без года", "2027-01-05T00:00:00.000Z"],
        ["🎂 Декабрь · 46", "2026-12-25T00:00:00.000Z"]
      ])
    );
    expect(items.some((item) => item.label.includes("Архив"))).toBe(false);
    expect(birthdayItems([contact({ id: "a", name: "x", birthday: "1990-01-01" })], undefined)).toEqual([]);
  });

  it("ignores ids that are not birthday pills", () => {
    expect(contactIdFromBirthdayItem("recurring-1")).toBeNull();
  });
});
