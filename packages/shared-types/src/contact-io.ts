import {
  CONTACT_BIRTHDAY_NO_YEAR,
  contactEmailList,
  contactPhoneList,
  isValidDayKey,
  normalizeChannels,
  normalizeTags,
  type ContactCard,
  type ContactChannel,
  type CreateContactCardInput
} from "./contact";

/**
 * Import/export of contacts as vCard (.vcf — phones, Google/Apple contacts) and
 * CSV (Google «Контакты», Excel). Pure text in, `CreateContactCardInput[]` out:
 * the browser reads the file and the API only ever sees validated rows.
 */

type Draft = Omit<CreateContactCardInput, "phone" | "email">;

function emptyDraft(): Draft {
  return {
    name: "",
    kind: "person",
    organization: "",
    role: "",
    phones: [],
    emails: [],
    links: [],
    address: "",
    birthday: null,
    tags: [],
    favorite: false,
    contactEveryDays: null,
    note: "",
    homeId: null
  };
}

/** Finish a draft into a row the contacts API accepts; null when there is nothing worth keeping. */
function finishDraft(draft: Draft): CreateContactCardInput | null {
  const phones = normalizeChannels(draft.phones, "phone");
  const emails = normalizeChannels(draft.emails).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.value));
  const name = (draft.name || draft.organization || emails[0]?.value || phones[0]?.value || "").trim().slice(0, 120);
  if (!name) return null;
  return {
    ...draft,
    name,
    organization: draft.organization.trim().slice(0, 120),
    role: draft.role.trim().slice(0, 80),
    phone: phones[0]?.value.slice(0, 40) ?? "",
    email: emails[0]?.value ?? "",
    phones: phones.map((item) => ({ ...item, value: item.value.slice(0, 254) })),
    emails,
    links: normalizeChannels(draft.links).slice(0, 15),
    address: draft.address.trim().slice(0, 300),
    birthday: draft.birthday && isValidDayKey(draft.birthday) ? draft.birthday : null,
    tags: normalizeTags(draft.tags).slice(0, 20),
    note: draft.note.slice(0, 2_000)
  };
}

const TYPE_LABEL: Record<string, string> = {
  cell: "мобильный",
  mobile: "мобильный",
  work: "рабочий",
  home: "домашний",
  fax: "факс",
  main: "основной",
  iphone: "мобильный"
};

const LABEL_TYPE: Record<string, string> = {
  мобильный: "CELL",
  рабочий: "WORK",
  домашний: "HOME"
};

// -------------------------------------------------------------------- vCard

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

/** Split on `separator` ignoring backslash-escaped ones. */
function splitEscaped(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] as string;
    if (char === "\\" && i + 1 < value.length) {
      current += char + value[i + 1];
      i += 1;
    } else if (char === separator) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function typeParam(label: string): string {
  const mapped = LABEL_TYPE[label.trim().toLocaleLowerCase("ru")];
  return mapped ? `;TYPE=${mapped}` : "";
}

/** A `.vcf` text with one vCard 3.0 per contact (archived ones included — the caller filters). */
export function contactsToVCard(contacts: ContactCard[]): string {
  const lines: string[] = [];
  for (const contact of contacts) {
    const [given = "", ...rest] = contact.name.trim().split(/\s+/);
    lines.push("BEGIN:VCARD", "VERSION:3.0", `FN:${escapeText(contact.name)}`);
    lines.push(
      contact.kind === "organization" ? `N:${escapeText(contact.name)};;;;` : `N:${escapeText(rest.join(" "))};${escapeText(given)};;;`
    );
    if (contact.kind === "organization") lines.push("X-ABShowAs:COMPANY");
    if (contact.organization) lines.push(`ORG:${escapeText(contact.organization)}`);
    if (contact.role) lines.push(`TITLE:${escapeText(contact.role)}`);
    for (const phone of contactPhoneList(contact)) lines.push(`TEL${typeParam(phone.label)}:${escapeText(phone.value)}`);
    for (const email of contactEmailList(contact)) lines.push(`EMAIL${typeParam(email.label)}:${escapeText(email.value)}`);
    for (const link of contact.links) {
      if (/^https?:\/\//i.test(link.value)) lines.push(`URL:${escapeText(link.value)}`);
      else lines.push(`X-SOCIALPROFILE;TYPE=${escapeText(link.label || "other")}:${escapeText(link.value)}`);
    }
    if (contact.address) lines.push(`ADR;TYPE=HOME:;;${escapeText(contact.address)};;;;`);
    if (contact.birthday) {
      lines.push(`BDAY:${Number(contact.birthday.slice(0, 4)) === CONTACT_BIRTHDAY_NO_YEAR ? `--${contact.birthday.slice(5)}` : contact.birthday}`);
    }
    if (contact.tags.length > 0) lines.push(`CATEGORIES:${contact.tags.map(escapeText).join(",")}`);
    if (contact.note) lines.push(`NOTE:${escapeText(contact.note)}`);
    lines.push("END:VCARD");
  }
  return `${lines.join("\r\n")}\r\n`;
}

function parseBirthday(raw: string): string | null {
  const value = raw.trim();
  const full = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value);
  if (full) {
    const key = `${full[1]}-${full[2]}-${full[3]}`;
    return isValidDayKey(key) ? key : null;
  }
  const noYear = /^--(\d{2})-?(\d{2})$/.exec(value);
  if (noYear) {
    const key = `${CONTACT_BIRTHDAY_NO_YEAR}-${noYear[1]}-${noYear[2]}`;
    return isValidDayKey(key) ? key : null;
  }
  return null;
}

function labelFromTypes(types: string[]): string {
  for (const type of types) {
    const mapped = TYPE_LABEL[type.toLowerCase()];
    if (mapped) return mapped;
  }
  return "";
}

/** Reads every vCard (2.1/3.0/4.0, group prefixes, folded lines) in `text`; unusable cards are skipped. */
export function parseVCards(text: string): CreateContactCardInput[] {
  const unfolded = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
  const out: CreateContactCardInput[] = [];
  let draft: Draft | null = null;
  let formattedName = "";
  let structuredName = "";

  for (const line of unfolded.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      draft = emptyDraft();
      formattedName = "";
      structuredName = "";
      continue;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      if (draft) {
        draft.name = formattedName || structuredName;
        const finished = finishDraft(draft);
        if (finished) out.push(finished);
      }
      draft = null;
      continue;
    }
    if (!draft) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 1) continue;
    const head = trimmed.slice(0, colon).replace(/^[\w-]+\./, "");
    const value = trimmed.slice(colon + 1);
    const [rawName = "", ...params] = head.split(";");
    const name = rawName.toUpperCase();
    const types = params
      .flatMap((param) => (/^TYPE=/i.test(param) ? param.slice(5).split(",") : /^[A-Za-z]+$/.test(param) ? [param] : []))
      .map((type) => type.replace(/"/g, ""));

    switch (name) {
      case "FN":
        formattedName = unescapeText(value).trim();
        break;
      case "N": {
        const [family = "", given = "", additional = ""] = splitEscaped(value, ";").map((part) => unescapeText(part).trim());
        structuredName = [given, additional, family].filter(Boolean).join(" ");
        break;
      }
      case "ORG":
        draft.organization = unescapeText(splitEscaped(value, ";")[0] ?? "").trim();
        break;
      case "TITLE":
      case "ROLE":
        if (!draft.role) draft.role = unescapeText(value).trim();
        break;
      case "TEL":
        draft.phones = [...(draft.phones ?? []), { label: labelFromTypes(types), value: unescapeText(value).replace(/^tel:/i, "").trim() }];
        break;
      case "EMAIL":
        draft.emails = [...(draft.emails ?? []), { label: labelFromTypes(types), value: unescapeText(value).trim() }];
        break;
      case "URL":
        draft.links = [...(draft.links ?? []), { label: "сайт", value: unescapeText(value).trim() }];
        break;
      case "X-SOCIALPROFILE":
      case "X-ORION-LINK":
        draft.links = [...(draft.links ?? []), { label: types[0] && types[0] !== "other" ? types[0] : "профиль", value: unescapeText(value).trim() }];
        break;
      case "ADR": {
        const parts = splitEscaped(value, ";").map((part) => unescapeText(part).trim()).filter(Boolean);
        if (!draft.address) draft.address = parts.join(", ");
        break;
      }
      case "BDAY":
        draft.birthday = parseBirthday(value);
        break;
      case "CATEGORIES":
        draft.tags = [...(draft.tags ?? []), ...splitEscaped(value, ",").map((tag) => unescapeText(tag).trim())];
        break;
      case "NOTE":
        draft.note = unescapeText(value);
        break;
      case "X-ABSHOWAS":
        if (/^company$/i.test(value.trim())) draft.kind = "organization";
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------- CSV

/** Splits CSV text into rows; handles quotes, doubled quotes and newlines inside quotes. */
function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((delimiter) => [delimiter, firstLine.split(delimiter).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

function csvEscape(value: string): string {
  return /[";\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_HEADER = ["Имя", "Тип", "Организация", "Должность", "Телефоны", "Почты", "Ссылки", "Адрес", "День рождения", "Теги", "Заметка"];
const CHANNEL_SEPARATOR = " | ";

function channelsToCell(channels: ContactChannel[]): string {
  return channels.map((item) => (item.label ? `${item.value} (${item.label})` : item.value)).join(CHANNEL_SEPARATOR);
}

function cellToChannels(cell: string, defaultLabel = ""): ContactChannel[] {
  return cell
    .split(CHANNEL_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const labelled = /^(.*\S)\s+\(([^()]{1,40})\)$/.exec(part);
      return labelled ? { label: labelled[2] as string, value: labelled[1] as string } : { label: defaultLabel, value: part };
    });
}

/** Semicolon-delimited CSV (opens in Excel with a Russian locale); the caller prepends a BOM when saving. */
export function contactsToCsv(contacts: ContactCard[]): string {
  const rows = contacts.map((contact) =>
    [
      contact.name,
      contact.kind === "organization" ? "организация" : "человек",
      contact.organization,
      contact.role,
      channelsToCell(contactPhoneList(contact)),
      channelsToCell(contactEmailList(contact)),
      channelsToCell(contact.links),
      contact.address,
      contact.birthday ?? "",
      contact.tags.join(", "),
      contact.note
    ].map(csvEscape)
  );
  return [CSV_HEADER.map(csvEscape), ...rows].map((row) => row.join(";")).join("\r\n") + "\r\n";
}

type Column = { index: number; header: string };

function findColumn(columns: Column[], matcher: RegExp, exclude?: RegExp): Column | undefined {
  return columns.find((column) => matcher.test(column.header) && !(exclude && exclude.test(column.header)));
}

/** Reads a contacts CSV: our own export, Google Contacts («First Name», «Phone 1 - Value»…) or any table with obvious headers. */
export function parseContactsCsv(text: string): CreateContactCardInput[] {
  const rows = parseCsvRows(text, detectDelimiter(text));
  const headerRow = rows[0];
  if (!headerRow) return [];
  const columns: Column[] = headerRow.map((header, index) => ({ index, header: header.trim().toLowerCase() }));
  const cell = (row: string[], column: Column | undefined): string => (column ? (row[column.index] ?? "").trim() : "");

  const nameCol = findColumn(columns, /^(name|display name|имя|название|фио|контакт)$/);
  const firstCol = findColumn(columns, /^(first name|given name|имя)$/);
  const middleCol = findColumn(columns, /^(middle name|additional name|отчество)$/);
  const lastCol = findColumn(columns, /^(last name|family name|surname|фамилия)$/);
  const kindCol = findColumn(columns, /^(тип|type|kind)$/);
  const orgCol = findColumn(columns, /^(organization( 1)?( -)? ?name|organization|company|организация|компания)$/);
  const roleCol = findColumn(columns, /^(organization( 1)?( -)? ?title|job title|title|должность|роль)$/);
  const phoneCols = columns.filter((column) => /(phone|tel|телефон|mobile|моб)/.test(column.header) && !/(label|type|тип)/.test(column.header));
  const emailCols = columns.filter((column) => /(e-?mail|почта)/.test(column.header) && !/(label|type|тип)/.test(column.header));
  const linkCols = columns.filter((column) => /(website|url|сайт|ссылк)/.test(column.header) && !/(label|type|тип)/.test(column.header));
  const addressCol = columns.find((column) => /(address|адрес)/.test(column.header) && /(formatted|^address$|^адрес$|street)/.test(column.header));
  const birthdayCol = findColumn(columns, /^(birthday|bday|день рождения|дата рождения)$/);
  const tagsCol = findColumn(columns, /^(labels|group membership|categories|теги|группа|группы)$/);
  const noteCol = findColumn(columns, /^(notes?|заметк[аи])$/);

  const labelFor = (row: string[], column: Column): string => {
    const labelHeader = column.header.replace(/value$/, "label");
    const typeHeader = column.header.replace(/value$/, "type");
    return cell(row, columns.find((candidate) => candidate.header === labelHeader || candidate.header === typeHeader));
  };

  const out: CreateContactCardInput[] = [];
  for (const row of rows.slice(1)) {
    const draft = emptyDraft();
    const parts = [cell(row, firstCol), cell(row, middleCol), cell(row, lastCol)].filter(Boolean).join(" ");
    draft.name = cell(row, nameCol) || parts;
    draft.organization = cell(row, orgCol);
    draft.role = cell(row, roleCol);
    if (/орган|org|company|компан/i.test(cell(row, kindCol))) draft.kind = "organization";
    for (const column of phoneCols) draft.phones = [...(draft.phones ?? []), ...cellToChannels(cell(row, column), labelFor(row, column).replace(/^\*+\s*/, ""))];
    for (const column of emailCols) draft.emails = [...(draft.emails ?? []), ...cellToChannels(cell(row, column), labelFor(row, column).replace(/^\*+\s*/, ""))];
    for (const column of linkCols) draft.links = [...(draft.links ?? []), ...cellToChannels(cell(row, column), "сайт")];
    draft.address = cell(row, addressCol);
    const birthday = cell(row, birthdayCol);
    draft.birthday = birthday ? parseBirthday(birthday) ?? parseRussianDate(birthday) : null;
    draft.tags = cell(row, tagsCol)
      .split(/\s*(?::::|,|;)\s*/)
      .map((tag) => tag.replace(/^\*\s*/, "").trim())
      .filter((tag) => tag && tag.toLowerCase() !== "mycontacts");
    draft.note = cell(row, noteCol);
    const finished = finishDraft(draft);
    if (finished) out.push(finished);
  }
  return out;
}

function parseRussianDate(value: string): string | null {
  const match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value.trim());
  if (!match) return null;
  const key = `${match[3]}-${(match[2] as string).padStart(2, "0")}-${(match[1] as string).padStart(2, "0")}`;
  return isValidDayKey(key) ? key : null;
}
