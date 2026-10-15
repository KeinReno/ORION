"use client";

import { Badge, cx } from "@orion/ui";
import { Cake, PhoneCall } from "lucide-react";
import { useState } from "react";
import { daysUntilLabel, type UpcomingContactEvent } from "../../lib/contacts";
import { ContactAvatar } from "./contact-avatar";

const VISIBLE = 6;

/** «Ближайшее»: birthdays in the next month and contacts it is time to reach out to. */
export function ContactsUpcoming({ events, onOpen }: { events: UpcomingContactEvent[]; onOpen: (id: string) => void }): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;
  const shown = expanded ? events : events.slice(0, VISIBLE);
  return (
    <section aria-label="Ближайшие даты" className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">Ближайшее · {events.length}</h3>
        {events.length > VISIBLE ? (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="text-2xs text-subtle-foreground hover:text-foreground">
            {expanded ? "Свернуть" : `Показать все`}
          </button>
        ) : null}
      </div>
      <ul className={cx("flex gap-2 pb-1", expanded ? "flex-wrap" : "orion-scroll overflow-x-auto")}>
        {shown.map((event) => {
          const Icon = event.kind === "birthday" ? Cake : PhoneCall;
          const urgent = event.daysUntil <= 0;
          return (
            <li key={`${event.kind}-${event.contact.id}`} className="shrink-0">
              <button
                type="button"
                onClick={() => onOpen(event.contact.id)}
                className={cx(
                  "flex w-64 items-center gap-2.5 rounded-xl border bg-card px-2.5 py-2 text-left transition-colors hover:bg-card-hover",
                  urgent ? "border-warning/40" : "border-border"
                )}
              >
                <ContactAvatar name={event.contact.name} kind={event.contact.kind} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-foreground">{event.contact.name}</span>
                  <span className="flex items-center gap-1 truncate text-2xs text-subtle-foreground">
                    <Icon className="h-3 w-3 shrink-0" aria-hidden /> {event.detail}
                  </span>
                </span>
                <Badge tone={urgent ? "warning" : "neutral"} icon={false}>
                  {daysUntilLabel(event.daysUntil)}
                </Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
