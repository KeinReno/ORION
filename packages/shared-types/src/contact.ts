import { z } from "zod";

/**
 * Module «Контакты» — a person or organisation as a universal record
 * (PRODUCT_DIRECTION.md: «Контакты — универсальная сущность; клиентская
 * воронка, сделки и CRM-поля — расширение»). It is the same `contacts` table
 * the «Дом» module uses for a home's contacts: `homeId` is optional, a home
 * still shows and edits the contacts attached to it through its own API, and
 * deleting a home only drops the link (SET NULL) — the contact stays.
 *
 * Named `ContactCard` to stay distinct from «Дом»'s home-scoped `Contact` DTO.
 * Links and reminders come from the shared entity-link layer (type "contact");
 * contact↔contact relations («жена», «коллега») are their own small table,
 * because the entity-link catalog deliberately rejects same-type pairs.
 *
 * `phone` / `email` stay as the *primary* value (what «Дом» and older clients
 * read); the full lists live in `phones` / `emails`. The server keeps the two
 * in sync: when a list is written, the primary is its first value.
 */

export const contactKindSchema = z.enum(["person", "organization"]);
export type ContactKind = z.infer<typeof contactKindSchema>;
export const CONTACT_KIND_LABEL: Record<ContactKind, string> = { person: "Человек", organization: "Организация" };

/** A labelled value: a phone («рабочий»), an email, a messenger/site («Telegram»). */
export const contactChannelSchema = z.object({
  label: z.string(),
  value: z.string()
});
export type ContactChannel = z.infer<typeof contactChannelSchema>;

/** Year stored for a birthday whose year is unknown (a leap year, so 29 февраля stays valid). */
export const CONTACT_BIRTHDAY_NO_YEAR = 1904;

export const contactCardSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  homeId: z.string().nullable(),
  kind: contactKindSchema,
  name: z.string(),
  /** Company a person works at (for an organisation: its parent/holding, usually empty). */
  organization: z.string(),
  /** Who they are to you: «сантехник», «бухгалтер», «клиент». */
  role: z.string(),
  /** Primary phone — first of `phones`. */
  phone: z.string(),
  /** Primary email — first of `emails`. */
  email: z.string(),
  phones: z.array(contactChannelSchema),
  emails: z.array(contactChannelSchema),
  /** Messengers, social profiles, websites: the label says which («Telegram», «сайт»). */
  links: z.array(contactChannelSchema),
  address: z.string(),
  /** `YYYY-MM-DD`; year `CONTACT_BIRTHDAY_NO_YEAR` means «год неизвестен». */
  birthday: z.string().nullable(),
  tags: z.array(z.string()),
  favorite: z.boolean(),
  /** «Связаться раз в N дней»; null — не напоминать. */
  contactEveryDays: z.number().int().nullable(),
  lastContactedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ContactCard = z.infer<typeof contactCardSchema>;

const emailField = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || z.string().email().safeParse(value).success, "Введите корректный email");

const channelInputSchema = z.object({
  label: z.string().trim().max(40).default(""),
  value: z.string().trim().min(1, "Значение не может быть пустым").max(254)
});

const emailChannelInputSchema = z.object({
  label: z.string().trim().max(40).default(""),
  value: z
    .string()
    .trim()
    .min(1, "Значение не может быть пустым")
    .max(254)
    .refine((value) => z.string().email().safeParse(value).success, "Введите корректный email")
});

/** `YYYY-MM-DD` that is a real calendar day. */
export function isValidDayKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const birthdayField = z.string().refine(isValidDayKey, "Введите дату как ГГГГ-ММ-ДД");
const tagsField = z.array(z.string().trim().min(1).max(30)).max(20);
const cadenceField = z.number().int().min(1).max(3650);

export const createContactCardInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120),
  kind: contactKindSchema.default("person"),
  organization: z.string().trim().max(120).default(""),
  role: z.string().trim().max(80).default(""),
  /** Legacy single-value shortcuts; ignored when the matching list is given. */
  phone: z.string().trim().max(40).default(""),
  email: emailField.default(""),
  phones: z.array(channelInputSchema).max(10).optional(),
  emails: z.array(emailChannelInputSchema).max(10).optional(),
  links: z.array(channelInputSchema).max(15).optional(),
  address: z.string().trim().max(300).default(""),
  birthday: birthdayField.nullable().optional(),
  tags: tagsField.default([]),
  favorite: z.boolean().default(false),
  contactEveryDays: cadenceField.nullable().optional(),
  note: z.string().max(2_000).default(""),
  /** Attach to a home of the «Дом» module (must be in the same workspace). */
  homeId: z.string().nullable().optional()
});
export type CreateContactCardInput = z.infer<typeof createContactCardInputSchema>;

export const updateContactCardInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120).optional(),
  kind: contactKindSchema.optional(),
  organization: z.string().trim().max(120).optional(),
  role: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  email: emailField.optional(),
  phones: z.array(channelInputSchema).max(10).optional(),
  emails: z.array(emailChannelInputSchema).max(10).optional(),
  links: z.array(channelInputSchema).max(15).optional(),
  address: z.string().trim().max(300).optional(),
  birthday: birthdayField.nullable().optional(),
  tags: tagsField.optional(),
  favorite: z.boolean().optional(),
  contactEveryDays: cadenceField.nullable().optional(),
  /** true — в архив, false — вернуть; момент архивации ставит сервер. */
  archived: z.boolean().optional(),
  note: z.string().max(2_000).optional(),
  homeId: z.string().nullable().optional()
});
export type UpdateContactCardInput = z.infer<typeof updateContactCardInputSchema>;

// ------------------------------------------------------------------ journal

export const CONTACT_INTERACTION_KINDS = ["call", "message", "meeting", "email", "other"] as const;
export const contactInteractionKindSchema = z.enum(CONTACT_INTERACTION_KINDS);
export type ContactInteractionKind = z.infer<typeof contactInteractionKindSchema>;
export const CONTACT_INTERACTION_LABEL: Record<ContactInteractionKind, string> = {
  call: "Звонок",
  message: "Сообщение",
  meeting: "Встреча",
  email: "Письмо",
  other: "Другое"
};

/** One entry in a contact's communication journal. */
export const contactInteractionSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  kind: contactInteractionKindSchema,
  note: z.string(),
  occurredAt: z.string(),
  createdAt: z.string()
});
export type ContactInteraction = z.infer<typeof contactInteractionSchema>;

export const createContactInteractionInputSchema = z.object({
  kind: contactInteractionKindSchema.default("other"),
  note: z.string().max(2_000).default(""),
  /** ISO instant; omitted ⇒ now. */
  occurredAt: z.string().datetime({ offset: true }).optional()
});
export type CreateContactInteractionInput = z.infer<typeof createContactInteractionInputSchema>;

// ---------------------------------------------------------------- relations

/** A relation seen from one contact: who the other side is and how they are related. */
export const contactRelationSchema = z.object({
  id: z.string(),
  otherId: z.string(),
  otherName: z.string(),
  label: z.string()
});
export type ContactRelation = z.infer<typeof contactRelationSchema>;

export const createContactRelationInputSchema = z.object({
  otherId: z.string().min(1),
  label: z.string().trim().max(60).default("")
});
export type CreateContactRelationInput = z.infer<typeof createContactRelationInputSchema>;

export const CONTACT_RELATION_SUGGESTIONS = [
  "супруг(а)",
  "родитель",
  "ребёнок",
  "брат / сестра",
  "друг",
  "коллега",
  "руководитель",
  "партнёр",
  "сосед",
  "знакомый"
] as const;

// -------------------------------------------------------------------- bulk

export const CONTACT_BULK_ACTIONS = ["addTag", "removeTag", "archive", "restore", "favorite", "unfavorite", "delete"] as const;
export const bulkContactsInputSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    action: z.enum(CONTACT_BULK_ACTIONS),
    tag: z.string().trim().min(1).max(30).optional()
  })
  .refine((value) => (value.action === "addTag" || value.action === "removeTag" ? Boolean(value.tag) : true), {
    message: "Укажите тег",
    path: ["tag"]
  });
export type BulkContactsInput = z.infer<typeof bulkContactsInputSchema>;
export interface BulkContactsResult {
  affected: number;
}

export const importContactsInputSchema = z.object({
  items: z.array(createContactCardInputSchema).min(1).max(2_000),
  /** Skip rows that look like an existing contact (same phone / email / name). */
  skipDuplicates: z.boolean().default(true)
});
export type ImportContactsInput = z.infer<typeof importContactsInputSchema>;
export interface ImportContactsResult {
  created: number;
  skipped: number;
}

export const mergeContactsInputSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1).max(20)
});
export type MergeContactsInput = z.infer<typeof mergeContactsInputSchema>;

// ------------------------------------------------------------------ helpers

/** Digits that identify a phone number; the last 10 so «8 900…» and «+7 900…» match. */
export function contactPhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function trimTo(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/** Drops blanks and repeats (by value), trims and caps; `phones` compare by digits, others case-insensitively. */
export function normalizeChannels(list: ContactChannel[] | undefined, mode: "phone" | "text" = "text"): ContactChannel[] {
  const seen = new Set<string>();
  const out: ContactChannel[] = [];
  for (const item of list ?? []) {
    const value = trimTo(item.value, 254);
    if (!value) continue;
    const key = mode === "phone" ? contactPhoneKey(value) || value : value.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: trimTo(item.label, 40), value });
  }
  return out;
}

/** Trimmed, de-duplicated (case-insensitive, first spelling wins) tags. */
export function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const value = trimTo(tag, 30);
    const key = value.toLocaleLowerCase("ru");
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

type ContactSearchFields = Pick<ContactCard, "name" | "role" | "phone" | "email" | "note"> &
  Partial<Pick<ContactCard, "organization" | "address" | "phones" | "emails" | "links" | "tags">>;

/** Case-insensitive match over every text field and over phone digits — the panel's client-side search. */
export function contactMatches(contact: ContactSearchFields, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("ru");
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  const texts = [
    contact.name,
    contact.role,
    contact.email,
    contact.note,
    contact.organization ?? "",
    contact.address ?? "",
    ...(contact.tags ?? []),
    ...(contact.emails ?? []).map((item) => item.value),
    ...(contact.links ?? []).flatMap((item) => [item.value, item.label])
  ];
  if (texts.some((field) => field.toLocaleLowerCase("ru").includes(needle))) return true;
  if (digits.length < 3) return false;
  const phones = [contact.phone, ...(contact.phones ?? []).map((item) => item.value)];
  return phones.some((phone) => phone.replace(/\D/g, "").includes(digits));
}

// -------------------------------------------------------------------- dates

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayNumber(key: string): number {
  return Math.round(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86_400_000);
}

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic in UTC, no DST surprises). */
export function addDaysToKey(key: string, days: number): string {
  const date = new Date((dayNumber(key) + days) * 86_400_000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function daysBetweenKeys(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar day an instant falls on *for whoever is looking* (browser or server local zone) — not the UTC day. */
export function isoToLocalDayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export interface NextBirthday {
  /** The coming occurrence, `YYYY-MM-DD`. */
  date: string;
  /** 0 — сегодня. */
  daysUntil: number;
  /** Age they turn; null when the year is unknown. */
  turning: number | null;
}

/** A birthday's next occurrence on or after `todayKey`; 29 февраля falls on 28 февраля in common years. */
export function nextBirthday(birthday: string, todayKey: string): NextBirthday | null {
  if (!isValidDayKey(birthday) || !isValidDayKey(todayKey)) return null;
  const year = Number(birthday.slice(0, 4));
  const month = Number(birthday.slice(5, 7));
  const day = Number(birthday.slice(8, 10));
  const occurrence = (target: number): string => `${target}-${pad(month)}-${pad(month === 2 && day === 29 && !isLeapYear(target) ? 28 : day)}`;
  const thisYear = Number(todayKey.slice(0, 4));
  let date = occurrence(thisYear);
  if (dayNumber(date) < dayNumber(todayKey)) date = occurrence(thisYear + 1);
  return {
    date,
    daysUntil: dayNumber(date) - dayNumber(todayKey),
    turning: year === CONTACT_BIRTHDAY_NO_YEAR ? null : Number(date.slice(0, 4)) - year
  };
}

/** «ММ-ДД» of a birthday, for display without the year. */
export function birthdayMonthDay(birthday: string): string {
  return birthday.slice(5);
}

export interface ContactFollowUp {
  /** The day the next contact is due, `YYYY-MM-DD`. */
  dueDate: string;
  /** Days past due (negative — still ahead). */
  overdueDays: number;
}

/** When to reach out next: last contact (or, if never, creation) plus the cadence. Null without a cadence. */
export function contactFollowUp(
  contact: Pick<ContactCard, "contactEveryDays" | "lastContactedAt" | "createdAt" | "archivedAt">,
  todayKey: string
): ContactFollowUp | null {
  if (contact.contactEveryDays === null || contact.archivedAt !== null) return null;
  const base = isoToLocalDayKey(contact.lastContactedAt ?? contact.createdAt);
  if (!isValidDayKey(base) || !isValidDayKey(todayKey)) return null;
  const dueDate = addDaysToKey(base, contact.contactEveryDays);
  return { dueDate, overdueDays: daysBetweenKeys(dueDate, todayKey) };
}

// ---------------------------------------------------------------- duplicates

function nameKey(name: string): string {
  const tokens = name
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort();
  return tokens.join(" ");
}

export interface ContactDuplicateGroup {
  ids: string[];
  reasons: ("phone" | "email" | "name")[];
}

type DuplicateFields = Pick<ContactCard, "id" | "name" | "phone" | "email" | "kind"> &
  Partial<Pick<ContactCard, "phones" | "emails" | "archivedAt">>;

function duplicateKeys(contact: DuplicateFields): { key: string; reason: "phone" | "email" | "name" }[] {
  const keys: { key: string; reason: "phone" | "email" | "name" }[] = [];
  const phones = [contact.phone, ...(contact.phones ?? []).map((item) => item.value)];
  for (const phone of phones) {
    const digits = contactPhoneKey(phone);
    if (digits.length >= 7) keys.push({ key: `p:${digits}`, reason: "phone" });
  }
  const emails = [contact.email, ...(contact.emails ?? []).map((item) => item.value)];
  for (const email of emails) {
    const value = email.trim().toLocaleLowerCase("ru");
    if (value) keys.push({ key: `e:${value}`, reason: "email" });
  }
  const name = nameKey(contact.name);
  if (name) keys.push({ key: `n:${contact.kind}:${name}`, reason: "name" });
  return keys;
}

/** Groups of active contacts that share a phone, an email or a name (word order ignored). */
export function findContactDuplicates(contacts: DuplicateFields[]): ContactDuplicateGroup[] {
  const active = contacts.filter((contact) => !contact.archivedAt);
  const parent = new Map<string, string>(active.map((contact) => [contact.id, contact.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  const owner = new Map<string, string>();
  const reasonsById = new Map<string, Set<"phone" | "email" | "name">>();
  for (const contact of active) {
    for (const { key, reason } of duplicateKeys(contact)) {
      const first = owner.get(key);
      if (first === undefined) {
        owner.set(key, contact.id);
        continue;
      }
      parent.set(find(contact.id), find(first));
      for (const id of [contact.id, first]) {
        const set = reasonsById.get(id) ?? new Set();
        set.add(reason);
        reasonsById.set(id, set);
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const contact of active) {
    const root = find(contact.id);
    groups.set(root, [...(groups.get(root) ?? []), contact.id]);
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ({
      ids,
      reasons: (["phone", "email", "name"] as const).filter((reason) => ids.some((id) => reasonsById.get(id)?.has(reason)))
    }));
}

// --------------------------------------------------------------------- merge

/**
 * The fields to write into `target` when `sources` are folded into it:
 * empty scalars are filled from the sources, lists and tags are united without
 * repeats, notes are joined, a favourite stays a favourite. (Journal entries,
 * relations, links and `lastContactedAt` are moved by the server.)
 */
export function mergeContactFields(target: ContactCard, sources: ContactCard[]): UpdateContactCardInput {
  const all = [target, ...sources];
  const firstFilled = (pick: (contact: ContactCard) => string): string => all.map(pick).find((value) => value.trim() !== "") ?? "";
  const notes: string[] = [];
  for (const contact of all) {
    const note = contact.note.trim();
    if (note && !notes.includes(note)) notes.push(note);
  }
  return {
    organization: firstFilled((contact) => contact.organization),
    role: firstFilled((contact) => contact.role),
    address: firstFilled((contact) => contact.address),
    phones: normalizeChannels(all.flatMap((contact) => contactPhoneList(contact)), "phone"),
    emails: normalizeChannels(all.flatMap((contact) => contactEmailList(contact))),
    links: normalizeChannels(all.flatMap((contact) => contact.links)),
    tags: normalizeTags(all.flatMap((contact) => contact.tags)),
    favorite: all.some((contact) => contact.favorite),
    birthday: all.find((contact) => contact.birthday !== null)?.birthday ?? null,
    contactEveryDays: all.find((contact) => contact.contactEveryDays !== null)?.contactEveryDays ?? null,
    homeId: all.find((contact) => contact.homeId !== null)?.homeId ?? null,
    note: notes.join("\n\n").slice(0, 2_000)
  };
}

/** The phone list of a card, falling back to the primary `phone` for rows written before lists existed. */
export function contactPhoneList(contact: Pick<ContactCard, "phone" | "phones">): ContactChannel[] {
  return contact.phones.length > 0 ? contact.phones : contact.phone ? [{ label: "", value: contact.phone }] : [];
}

export function contactEmailList(contact: Pick<ContactCard, "email" | "emails">): ContactChannel[] {
  return contact.emails.length > 0 ? contact.emails : contact.email ? [{ label: "", value: contact.email }] : [];
}
