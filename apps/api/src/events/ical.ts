/**
 * Hand-rolled RFC 5545 (iCalendar) serialisation for the read-only outbound
 * feed — see docs/HISTORY.md v0.10 "Уровень 1". VEVENT is a tiny, stable
 * format; a dependency (`ics`, `ical-generator`) would earn its keep only if
 * we also *parsed* .ics, which Уровень 1 deliberately doesn't. Treat this
 * like the project's other hand-written primitives.
 *
 * Not exported from a package — feed generation is a server-only concern,
 * so it lives next to EventsService.
 */

export interface ICalEntry {
  /** Stable, globally-unique id for this VEVENT. */
  uid: string;
  start: Date;
  /** Exclusive end. */
  end: Date;
  allDay: boolean;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** RRULE value without the `RRULE:` prefix (see recurrenceToRRule). */
  rrule?: string | null;
  /** Original starts to exclude from the RRULE expansion (canceled occurrences). */
  exdates?: Date[];
  /** Set on a standalone VEVENT that overrides one occurrence of `uid`'s series. */
  recurrenceId?: Date | null;
}

/** Escape TEXT per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** UTC `YYYYMMDDTHHMMSSZ`. */
function dtUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Date-only `YYYYMMDD` (for all-day VALUE=DATE). */
function dateOnly(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Fold a content line to <=75 octets with a leading space on continuations (RFC 5545 §3.1). */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  for (const ch of line) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 74) {
      out.push(chunk);
      chunk = " " + ch;
    } else {
      chunk += ch;
    }
  }
  if (chunk) out.push(chunk);
  return out.join("\r\n");
}

function vevent(entry: ICalEntry, stamp: Date): string[] {
  const lines: string[] = ["BEGIN:VEVENT", `UID:${entry.uid}`, `DTSTAMP:${dtUtc(stamp)}`];
  if (entry.recurrenceId) {
    lines.push(entry.allDay ? `RECURRENCE-ID;VALUE=DATE:${dateOnly(entry.recurrenceId)}` : `RECURRENCE-ID:${dtUtc(entry.recurrenceId)}`);
  }
  if (entry.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(entry.start)}`, `DTEND;VALUE=DATE:${dateOnly(entry.end)}`);
  } else {
    lines.push(`DTSTART:${dtUtc(entry.start)}`, `DTEND:${dtUtc(entry.end)}`);
  }
  if (entry.rrule) lines.push(`RRULE:${entry.rrule}`);
  if (entry.exdates && entry.exdates.length > 0) {
    lines.push(
      entry.allDay
        ? `EXDATE;VALUE=DATE:${entry.exdates.map(dateOnly).join(",")}`
        : `EXDATE:${entry.exdates.map(dtUtc).join(",")}`
    );
  }
  lines.push(`SUMMARY:${esc(entry.summary)}`);
  if (entry.description) lines.push(`DESCRIPTION:${esc(entry.description)}`);
  if (entry.location) lines.push(`LOCATION:${esc(entry.location)}`);
  if (entry.url) lines.push(`URL:${esc(entry.url)}`);
  lines.push("END:VEVENT");
  return lines;
}

/** A full VCALENDAR document with CRLF endings, ready to serve as text/calendar. */
export function buildICal(calendarName: string, entries: ICalEntry[]): string {
  const stamp = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ORION//Calendar//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calendarName)}`,
    ...entries.flatMap((entry) => vevent(entry, stamp)),
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
