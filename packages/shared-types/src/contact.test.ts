import { describe, expect, it } from "vitest";
import {
  CONTACT_BIRTHDAY_NO_YEAR,
  addDaysToKey,
  bulkContactsInputSchema,
  contactFollowUp,
  contactMatches,
  contactPhoneKey,
  createContactCardInputSchema,
  findContactDuplicates,
  mergeContactFields,
  nextBirthday,
  normalizeChannels,
  normalizeTags,
  type ContactCard
} from "./contact";
import { contactsToCsv, contactsToVCard, parseContactsCsv, parseVCards } from "./contact-io";

const card = { name: "Иван Петров", role: "сантехник", phone: "+7 (900) 123-45-67", email: "ivan@example.test", note: "только по будням" };

function full(overrides: Partial<ContactCard> & { id: string; name: string }): ContactCard {
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

describe("contacts contract", () => {
  it("matches by name, role, email, note and by phone digits regardless of formatting", () => {
    expect(contactMatches(card, "петров")).toBe(true);
    expect(contactMatches(card, "САНТЕХ")).toBe(true);
    expect(contactMatches(card, "example")).toBe(true);
    expect(contactMatches(card, "будням")).toBe(true);
    expect(contactMatches(card, "900 123")).toBe(true);
    expect(contactMatches(card, "электрик")).toBe(false);
    expect(contactMatches(card, "  ")).toBe(true);
  });

  it("also searches organisation, tags, extra phones and links", () => {
    const rich = { ...card, organization: "Ромашка", tags: ["семья"], phones: [{ label: "", value: "8 911 222-33-44" }], links: [{ label: "Telegram", value: "@ivan_p" }] };
    expect(contactMatches(rich, "ромашк")).toBe(true);
    expect(contactMatches(rich, "семья")).toBe(true);
    expect(contactMatches(rich, "911 222")).toBe(true);
    expect(contactMatches(rich, "ivan_p")).toBe(true);
    expect(contactMatches(rich, "gamma")).toBe(false);
  });

  it("accepts an empty email but rejects a malformed one", () => {
    expect(createContactCardInputSchema.parse({ name: "Аня" }).email).toBe("");
    expect(createContactCardInputSchema.safeParse({ name: "Аня", email: "not-an-email" }).success).toBe(false);
    expect(createContactCardInputSchema.safeParse({ name: " " }).success).toBe(false);
  });

  it("validates new fields", () => {
    expect(createContactCardInputSchema.parse({ name: "Аня" })).toMatchObject({ kind: "person", tags: [], favorite: false });
    expect(createContactCardInputSchema.safeParse({ name: "Аня", birthday: "2026-02-30" }).success).toBe(false);
    expect(createContactCardInputSchema.safeParse({ name: "Аня", birthday: "1990-05-17" }).success).toBe(true);
    expect(createContactCardInputSchema.safeParse({ name: "Аня", contactEveryDays: 0 }).success).toBe(false);
    expect(createContactCardInputSchema.safeParse({ name: "Аня", emails: [{ label: "", value: "bad" }] }).success).toBe(false);
    expect(bulkContactsInputSchema.safeParse({ ids: ["a"], action: "addTag" }).success).toBe(false);
    expect(bulkContactsInputSchema.safeParse({ ids: ["a"], action: "addTag", tag: "семья" }).success).toBe(true);
  });

  it("normalises channels and tags", () => {
    expect(contactPhoneKey("8 (900) 123-45-67")).toBe(contactPhoneKey("+7 900 123 45 67"));
    expect(
      normalizeChannels(
        [
          { label: "моб", value: "+7 900 123-45-67" },
          { label: "", value: "8 900 123 45 67" },
          { label: "", value: " " }
        ],
        "phone"
      )
    ).toHaveLength(1);
    expect(normalizeTags([" Семья ", "семья", "", "работа"])).toEqual(["Семья", "работа"]);
  });
});

describe("birthdays and follow-ups", () => {
  it("finds the next occurrence and the age", () => {
    expect(nextBirthday("1990-05-17", "2026-05-10")).toEqual({ date: "2026-05-17", daysUntil: 7, turning: 36 });
    expect(nextBirthday("1990-05-17", "2026-05-17")).toMatchObject({ daysUntil: 0, turning: 36 });
    expect(nextBirthday("1990-05-17", "2026-05-18")).toMatchObject({ date: "2027-05-17", turning: 37 });
    expect(nextBirthday(`${CONTACT_BIRTHDAY_NO_YEAR}-05-17`, "2026-05-10")?.turning).toBeNull();
    expect(nextBirthday("nope", "2026-05-10")).toBeNull();
  });

  it("moves 29 February to 28 February in common years", () => {
    expect(nextBirthday("2000-02-29", "2027-01-10")?.date).toBe("2027-02-28");
    expect(nextBirthday("2000-02-29", "2028-01-10")?.date).toBe("2028-02-29");
  });

  it("computes the follow-up day from the last contact or the creation day", () => {
    const base = { archivedAt: null, createdAt: "2026-01-01T10:00:00.000Z" };
    expect(contactFollowUp({ ...base, contactEveryDays: null, lastContactedAt: null }, "2026-03-01")).toBeNull();
    expect(contactFollowUp({ ...base, contactEveryDays: 30, lastContactedAt: null }, "2026-02-05")).toEqual({ dueDate: "2026-01-31", overdueDays: 5 });
    expect(contactFollowUp({ ...base, contactEveryDays: 30, lastContactedAt: "2026-02-01T08:00:00.000Z" }, "2026-02-20")).toEqual({
      dueDate: "2026-03-03",
      overdueDays: -11
    });
    expect(contactFollowUp({ ...base, archivedAt: "2026-02-01T00:00:00.000Z", contactEveryDays: 30, lastContactedAt: null }, "2026-02-05")).toBeNull();
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("duplicates and merge", () => {
  const a = full({ id: "a", name: "Иван Петров", phone: "+7 900 123-45-67" });
  const b = full({ id: "b", name: "Петров И.", phones: [{ label: "", value: "8 (900) 123-45-67" }] });
  const c = full({ id: "c", name: "Петров Иван" });
  const d = full({ id: "d", name: "Мария", email: "Maria@Example.test" });
  const e = full({ id: "e", name: "Маша", emails: [{ label: "", value: "maria@example.test" }] });
  const solo = full({ id: "f", name: "Один" });

  it("groups by phone, email and word-order-insensitive name", () => {
    const groups = findContactDuplicates([a, b, c, d, e, solo]);
    expect(groups.map((group) => [...group.ids].sort())).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(groups[0]?.reasons).toEqual(["phone", "name"]);
    expect(groups[1]?.reasons).toEqual(["email"]);
  });

  it("ignores archived contacts", () => {
    expect(findContactDuplicates([a, { ...c, archivedAt: "2026-01-02T00:00:00.000Z" }])).toEqual([]);
  });

  it("merges: fills blanks, unites lists and tags, joins notes", () => {
    const target = full({ id: "t", name: "Иван", phone: "+7 900 000-00-01", tags: ["семья"], note: "первая" });
    const source = full({
      id: "s",
      name: "Иван П.",
      role: "сантехник",
      phone: "+7 900 000-00-02",
      tags: ["Семья", "работа"],
      favorite: true,
      birthday: "1990-05-17",
      note: "вторая"
    });
    const merged = mergeContactFields(target, [source]);
    expect(merged.role).toBe("сантехник");
    expect(merged.phones?.map((p) => p.value)).toEqual(["+7 900 000-00-01", "+7 900 000-00-02"]);
    expect(merged.tags).toEqual(["семья", "работа"]);
    expect(merged.favorite).toBe(true);
    expect(merged.birthday).toBe("1990-05-17");
    expect(merged.note).toBe("первая\n\nвторая");
  });
});

describe("vCard and CSV", () => {
  const sample = full({
    id: "x",
    name: "Иван Петров",
    organization: "ООО «Ромашка»",
    role: "директор",
    phone: "+7 900 123-45-67",
    phones: [
      { label: "мобильный", value: "+7 900 123-45-67" },
      { label: "рабочий", value: "+7 495 000-00-00" }
    ],
    emails: [{ label: "", value: "ivan@example.test" }],
    links: [
      { label: "сайт", value: "https://example.test" },
      { label: "telegram", value: "@ivan_p" }
    ],
    address: "Москва, Тверская 1",
    birthday: "1990-05-17",
    tags: ["клиенты", "семья"],
    note: "строка 1\nстрока 2; с запятой, и точкой"
  });

  it("round-trips through vCard", () => {
    const [parsed] = parseVCards(contactsToVCard([sample]));
    expect(parsed).toMatchObject({
      name: "Иван Петров",
      organization: "ООО «Ромашка»",
      role: "директор",
      phone: "+7 900 123-45-67",
      email: "ivan@example.test",
      address: "Москва, Тверская 1",
      birthday: "1990-05-17",
      tags: ["клиенты", "семья"],
      note: "строка 1\nстрока 2; с запятой, и точкой"
    });
    expect(parsed?.phones?.map((p) => [p.label, p.value])).toEqual([
      ["мобильный", "+7 900 123-45-67"],
      ["рабочий", "+7 495 000-00-00"]
    ]);
    expect(parsed?.links?.map((l) => l.value)).toEqual(["https://example.test", "@ivan_p"]);
  });

  it("reads a phone-style vCard with groups, folded lines and a year-less birthday", () => {
    const text = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Сидорова;Мария;;;",
      "item1.TEL;type=CELL;type=VOICE;type=pref:+7 911 000-11-22",
      "EMAIL;TYPE=INTERNET:maria@exam",
      " ple.test",
      "BDAY:--03-08",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "END:VCARD"
    ].join("\r\n");
    const parsed = parseVCards(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "Мария Сидорова", phone: "+7 911 000-11-22", email: "maria@example.test", birthday: `${CONTACT_BIRTHDAY_NO_YEAR}-03-08` });
    expect(parsed[0]?.phones?.[0]?.label).toBe("мобильный");
  });

  it("round-trips through CSV and reads a Google export", () => {
    const [parsed] = parseContactsCsv(contactsToCsv([sample]));
    expect(parsed).toMatchObject({ name: "Иван Петров", organization: "ООО «Ромашка»", birthday: "1990-05-17", tags: ["клиенты", "семья"], note: "строка 1\nстрока 2; с запятой, и точкой" });
    expect(parsed?.phones).toHaveLength(2);

    const google = [
      "First Name,Last Name,Organization Name,Organization Title,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Birthday,Labels",
      'Анна,Орлова,Альфа,менеджер,* Work,anna@example.test,Mobile,"+7 922 555-66-77",1985-12-01,* myContacts ::: Клиенты'
    ].join("\n");
    const [row] = parseContactsCsv(google);
    expect(row).toMatchObject({ name: "Анна Орлова", organization: "Альфа", role: "менеджер", phone: "+7 922 555-66-77", email: "anna@example.test", birthday: "1985-12-01", tags: ["Клиенты"] });
  });
});
