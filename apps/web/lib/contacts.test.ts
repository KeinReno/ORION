import type { ContactCard } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTACT_FILTERS,
  collectTags,
  contactInitials,
  daysUntilLabel,
  filterContacts,
  formatBirthday,
  groupContacts,
  lastContactLabel,
  linkHref,
  phoneHref,
  sectionLetter,
  sortContacts,
  upcomingContactEvents
} from "./contacts";

function card(overrides: Partial<ContactCard> & { id: string; name: string }): ContactCard {
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

const anna = card({ id: "a", name: "Анна", tags: ["семья"], favorite: true, lastContactedAt: "2026-05-01T10:00:00.000Z" });
const boris = card({ id: "b", name: "Борис", kind: "person", tags: ["Работа"], createdAt: "2026-03-01T00:00:00.000Z" });
const romashka = card({ id: "c", name: "Ромашка", kind: "organization", tags: ["работа"], lastContactedAt: "2026-06-01T10:00:00.000Z" });
const old = card({ id: "d", name: "Архивный", archivedAt: "2026-02-01T00:00:00.000Z" });
const latin = card({ id: "e", name: "John" });
const yo = card({ id: "f", name: "Ёлкин" });
const all = [anna, boris, romashka, old, latin, yo];

describe("filtering and grouping", () => {
  it("separates active from archived and filters by tag, kind and favourites", () => {
    expect(filterContacts(all, DEFAULT_CONTACT_FILTERS).map((c) => c.id)).toEqual(["a", "b", "c", "e", "f"]);
    expect(filterContacts(all, { ...DEFAULT_CONTACT_FILTERS, scope: "archived" }).map((c) => c.id)).toEqual(["d"]);
    expect(filterContacts(all, { ...DEFAULT_CONTACT_FILTERS, tag: "РАБОТА" }).map((c) => c.id)).toEqual(["b", "c"]);
    expect(filterContacts(all, { ...DEFAULT_CONTACT_FILTERS, kind: "organization" }).map((c) => c.id)).toEqual(["c"]);
    expect(filterContacts(all, { ...DEFAULT_CONTACT_FILTERS, favoritesOnly: true }).map((c) => c.id)).toEqual(["a"]);
    expect(filterContacts(all, { ...DEFAULT_CONTACT_FILTERS, query: "борис" }).map((c) => c.id)).toEqual(["b"]);
  });

  it("sorts by name, by last contact and by creation", () => {
    expect(sortContacts([boris, anna], "name").map((c) => c.id)).toEqual(["a", "b"]);
    expect(sortContacts([anna, boris, romashka], "recent").map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(sortContacts([anna, boris], "added").map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("groups by letter with favourites on top, Ё under Е and non-letters last", () => {
    const sections = groupContacts([anna, boris, romashka, latin, yo, card({ id: "g", name: "42 бригада" })], "name");
    expect(sections.map((s) => s.key)).toEqual(["★", "Б", "J", "Е", "Р", "#"].sort((a, b) => (a === "★" ? -1 : b === "★" ? 1 : a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b, "ru"))));
    expect(sections[0]?.contacts.map((c) => c.id)).toEqual(["a"]);
    expect(sectionLetter("Ёлкин")).toBe("Е");
    expect(sectionLetter("")).toBe("#");
  });

  it("counts tags case-insensitively", () => {
    expect(collectTags([boris, romashka, anna])).toEqual([
      { tag: "Работа", count: 2 },
      { tag: "семья", count: 1 }
    ]);
  });
});

describe("upcoming events", () => {
  it("lists birthdays and due follow-ups, soonest first, skipping archived", () => {
    const birthday = card({ id: "h", name: "Ирина", birthday: "1990-06-20" });
    const due = card({ id: "i", name: "Олег", contactEveryDays: 10, lastContactedAt: "2026-06-01T00:00:00.000Z" });
    const far = card({ id: "j", name: "Далёкий", birthday: "1990-12-01" });
    const gone = card({ id: "k", name: "Архив", birthday: "1990-06-17", archivedAt: "2026-01-01T00:00:00.000Z" });
    const events = upcomingContactEvents([birthday, due, far, gone], "2026-06-17", 30);
    expect(events.map((e) => [e.contact.id, e.kind, e.daysUntil])).toEqual([
      ["i", "followup", -6],
      ["h", "birthday", 3]
    ]);
    expect(events[1]?.detail).toBe("Исполняется 36");
  });

  it("words relative days", () => {
    expect(daysUntilLabel(0)).toBe("сегодня");
    expect(daysUntilLabel(1)).toBe("завтра");
    expect(daysUntilLabel(3)).toBe("через 3 дня");
    expect(daysUntilLabel(-6)).toBe("6 дней назад");
    expect(daysUntilLabel(21)).toBe("через 21 день");
  });
});

describe("display helpers", () => {
  it("formats a birthday with the age, or without a year", () => {
    expect(formatBirthday("1990-06-20", "2026-06-17")).toBe("20 июня 1990 · 35 лет");
    expect(formatBirthday("1990-06-17", "2026-06-17")).toBe("17 июня 1990 · 36 лет");
    expect(formatBirthday("1904-03-08", "2026-06-17")).toBe("8 марта");
  });

  it("words the last contact", () => {
    expect(lastContactLabel(null, "2026-06-17")).toBe("ещё не общались");
    expect(lastContactLabel("2026-06-17T08:00:00.000Z", "2026-06-17")).toBe("сегодня");
    expect(lastContactLabel("2026-06-14T08:00:00.000Z", "2026-06-17")).toBe("3 дня назад");
  });

  it("builds initials and tel links", () => {
    expect(contactInitials("Иван Петров")).toBe("ИП");
    expect(contactInitials("ООО «Ромашка»")).toBe("ОР");
    expect(contactInitials("   ")).toBe("?");
    expect(phoneHref("+7 (900) 123-45-67")).toBe("tel:+79001234567");
  });

  it("opens messengers and sites", () => {
    expect(linkHref({ label: "Telegram", value: "@ivan_p" })).toBe("https://t.me/ivan_p");
    expect(linkHref({ label: "Telegram", value: "+7 900 123-45-67" })).toBe("https://t.me/+79001234567");
    expect(linkHref({ label: "WhatsApp", value: "+7 900 123-45-67" })).toBe("https://wa.me/79001234567");
    expect(linkHref({ label: "сайт", value: "example.test/page" })).toBe("https://example.test/page");
    expect(linkHref({ label: "", value: "https://example.test" })).toBe("https://example.test");
    expect(linkHref({ label: "что-то", value: "abc" })).toBeNull();
  });
});
