import {
  CONTACT_BIRTHDAY_NO_YEAR,
  contactEmailList,
  contactFollowUp,
  contactMatches,
  contactPhoneList,
  daysBetweenKeys,
  isoToLocalDayKey,
  nextBirthday,
  type ContactCard,
  type ContactChannel
} from "@orion/shared-types";

/** Pure helpers behind the «Контакты» panel — grouping, filtering, upcoming dates, link builders. */

export type ContactSort = "name" | "recent" | "added";
export type ContactScope = "active" | "archived";

export interface ContactFilters {
  query: string;
  scope: ContactScope;
  tag: string | null;
  kind: "all" | "person" | "organization";
  favoritesOnly: boolean;
}

export const DEFAULT_CONTACT_FILTERS: ContactFilters = { query: "", scope: "active", tag: null, kind: "all", favoritesOnly: false };

export function filterContacts(contacts: ContactCard[], filters: ContactFilters): ContactCard[] {
  const tagKey = filters.tag?.toLocaleLowerCase("ru") ?? null;
  return contacts.filter((contact) => {
    if ((filters.scope === "archived") !== (contact.archivedAt !== null)) return false;
    if (filters.kind !== "all" && contact.kind !== filters.kind) return false;
    if (filters.favoritesOnly && !contact.favorite) return false;
    if (tagKey && !contact.tags.some((tag) => tag.toLocaleLowerCase("ru") === tagKey)) return false;
    return contactMatches(contact, filters.query);
  });
}

export function sortContacts(contacts: ContactCard[], sort: ContactSort): ContactCard[] {
  const byName = (a: ContactCard, b: ContactCard): number => a.name.localeCompare(b.name, "ru");
  const copy = [...contacts];
  if (sort === "recent") {
    // Latest contact first; never-contacted ones go last, alphabetically.
    return copy.sort((a, b) => (b.lastContactedAt ?? "").localeCompare(a.lastContactedAt ?? "") || byName(a, b));
  }
  if (sort === "added") return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
  return copy.sort(byName);
}

export interface ContactSection {
  key: string;
  title: string;
  contacts: ContactCard[];
}

/** First letter of a name for the A–Я rail; digits, Latin and the rest are grouped honestly instead of lumped into «#». */
export function sectionLetter(name: string): string {
  const first = name.trim().charAt(0).toLocaleUpperCase("ru");
  if (!first) return "#";
  return /\p{L}/u.test(first) ? first.replace("Ё", "Е") : "#";
}

/** Favourites pinned on top (alphabetical sort only), then letter sections. */
export function groupContacts(contacts: ContactCard[], sort: ContactSort): ContactSection[] {
  const sorted = sortContacts(contacts, sort);
  if (sort !== "name") return [{ key: "all", title: sort === "recent" ? "По последнему контакту" : "Недавно добавленные", contacts: sorted }];
  const sections: ContactSection[] = [];
  const favorites = sorted.filter((contact) => contact.favorite);
  if (favorites.length > 0) sections.push({ key: "★", title: "Избранные", contacts: favorites });
  const byLetter = new Map<string, ContactCard[]>();
  for (const contact of sorted.filter((item) => !item.favorite)) {
    const letter = sectionLetter(contact.name);
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), contact]);
  }
  const letters = [...byLetter.keys()].sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b, "ru")));
  for (const letter of letters) sections.push({ key: letter, title: letter, contacts: byLetter.get(letter) ?? [] });
  return sections;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Tags of the given contacts with counts, most used first (case-insensitive, first spelling wins). */
export function collectTags(contacts: ContactCard[]): TagCount[] {
  const map = new Map<string, TagCount>();
  for (const contact of contacts) {
    for (const tag of contact.tags) {
      const key = tag.toLocaleLowerCase("ru");
      const entry = map.get(key);
      if (entry) entry.count += 1;
      else map.set(key, { tag, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ru"));
}

// ------------------------------------------------------------------ upcoming

export type UpcomingKind = "birthday" | "followup";

export interface UpcomingContactEvent {
  kind: UpcomingKind;
  contact: ContactCard;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Negative — overdue (follow-ups only). */
  daysUntil: number;
  /** «Исполняется 36» for a birthday with a known year. */
  detail: string;
}

/** Birthdays within `windowDays` and follow-ups that are due or fall inside the window, soonest first. */
export function upcomingContactEvents(contacts: ContactCard[], todayKey: string, windowDays = 30): UpcomingContactEvent[] {
  const events: UpcomingContactEvent[] = [];
  for (const contact of contacts) {
    if (contact.archivedAt) continue;
    if (contact.birthday) {
      const birthday = nextBirthday(contact.birthday, todayKey);
      if (birthday && birthday.daysUntil <= windowDays) {
        events.push({
          kind: "birthday",
          contact,
          date: birthday.date,
          daysUntil: birthday.daysUntil,
          detail: birthday.turning !== null ? `Исполняется ${birthday.turning}` : "День рождения"
        });
      }
    }
    const followUp = contactFollowUp(contact, todayKey);
    if (followUp && -followUp.overdueDays <= windowDays) {
      events.push({
        kind: "followup",
        contact,
        date: followUp.dueDate,
        daysUntil: -followUp.overdueDays,
        detail: followUp.overdueDays >= 0 ? "Пора связаться" : "Скоро связаться"
      });
    }
  }
  return events.sort((a, b) => a.daysUntil - b.daysUntil || a.contact.name.localeCompare(b.contact.name, "ru"));
}

export function daysUntilLabel(days: number): string {
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === -1) return "вчера";
  return days > 0 ? `через ${pluralDays(days)}` : `${pluralDays(-days)} назад`;
}

export function pluralDays(count: number): string {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return `${count} ${teen ? "дней" : last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней"}`;
}

// ------------------------------------------------------------------- display

const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «17 мая 1990 · 36 лет» or, for an unknown year, «17 мая». */
export function formatBirthday(birthday: string, todayKey: string): string {
  const year = Number(birthday.slice(0, 4));
  const month = Number(birthday.slice(5, 7));
  const day = Number(birthday.slice(8, 10));
  const label = `${day} ${MONTHS_GENITIVE[month - 1] ?? ""}`;
  if (year === CONTACT_BIRTHDAY_NO_YEAR) return label;
  const hadThisYear = birthday.slice(5) <= todayKey.slice(5);
  const age = Number(todayKey.slice(0, 4)) - year - (hadThisYear ? 0 : 1);
  const years = age % 10 === 1 && age % 100 !== 11 ? "год" : age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 10 || age % 100 >= 20) ? "года" : "лет";
  return `${label} ${year}${age >= 0 ? ` · ${age} ${years}` : ""}`;
}

/** «3 дня назад» / «сегодня» / «ещё не общались». */
export function lastContactLabel(lastContactedAt: string | null, todayKey: string): string {
  if (!lastContactedAt) return "ещё не общались";
  const days = daysBetweenKeys(isoToLocalDayKey(lastContactedAt), todayKey);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${pluralDays(days)} назад`;
}

export function contactInitials(name: string): string {
  const parts = name.trim().split(/[\s«»"']+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** A stable hue (0–359) per name, so the same person always has the same avatar colour. */
export function avatarHue(name: string): number {
  let hash = 0;
  for (const char of name.trim().toLocaleLowerCase("ru")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function avatarStyle(name: string): { color: string; backgroundColor: string; borderColor: string } {
  const hue = avatarHue(name);
  return { color: `hsl(${hue} 70% 80%)`, backgroundColor: `hsl(${hue} 55% 45% / 0.22)`, borderColor: `hsl(${hue} 55% 55% / 0.4)` };
}

// ------------------------------------------------------------------ link builders

/** `tel:` href that keeps a leading plus and drops formatting. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function emailHref(email: string): string {
  return `mailto:${email.trim()}`;
}

export type LinkKind = "telegram" | "whatsapp" | "viber" | "instagram" | "vk" | "linkedin" | "site" | "other";

const LINK_KIND_BY_LABEL: [RegExp, LinkKind][] = [
  [/telegram|телеграм|^tg$/i, "telegram"],
  [/whats ?app|вотсап|ватсап/i, "whatsapp"],
  [/viber|вайбер/i, "viber"],
  [/instagram|инстаграм/i, "instagram"],
  [/^vk|вк|вконтакте/i, "vk"],
  [/linked ?in/i, "linkedin"],
  [/сайт|site|web|url|ссылка/i, "site"]
];

export function linkKind(channel: ContactChannel): LinkKind {
  if (/^https?:\/\//i.test(channel.value) && !LINK_KIND_BY_LABEL.some(([pattern]) => pattern.test(channel.label))) return "site";
  return LINK_KIND_BY_LABEL.find(([pattern]) => pattern.test(channel.label))?.[1] ?? "other";
}

/** Where a messenger/site value opens; null when it can't be turned into a link. */
export function linkHref(channel: ContactChannel): string | null {
  const value = channel.value.trim();
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, "").replace(/^(https?:\/\/)?(t\.me|instagram\.com|vk\.com)\//i, "");
  switch (linkKind(channel)) {
    case "telegram":
      return /^\+?\d[\d\s()-]{6,}$/.test(value) ? `https://t.me/+${value.replace(/\D/g, "")}` : `https://t.me/${handle}`;
    case "whatsapp":
      return `https://wa.me/${value.replace(/\D/g, "")}`;
    case "viber":
      return `viber://chat?number=${encodeURIComponent(value.replace(/[^\d+]/g, ""))}`;
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "vk":
      return `https://vk.com/${handle}`;
    case "site":
      return /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(value) ? `https://${value}` : null;
    default:
      return null;
  }
}

/** Everything callable/writable about a contact, primary first — for the card's quick actions. */
export function contactReach(contact: ContactCard): { phones: ContactChannel[]; emails: ContactChannel[]; links: ContactChannel[] } {
  return { phones: contactPhoneList(contact), emails: contactEmailList(contact), links: contact.links };
}

export const LINK_LABEL_SUGGESTIONS = ["Telegram", "WhatsApp", "Viber", "Instagram", "ВКонтакте", "LinkedIn", "сайт"] as const;
export const PHONE_LABEL_SUGGESTIONS = ["мобильный", "рабочий", "домашний"] as const;
export const EMAIL_LABEL_SUGGESTIONS = ["личная", "рабочая"] as const;
