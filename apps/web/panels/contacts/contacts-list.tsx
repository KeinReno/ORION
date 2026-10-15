"use client";

import type { ContactCard } from "@orion/shared-types";
import { Badge, cx } from "@orion/ui";
import { Mail, Phone, Star } from "lucide-react";
import { emailHref, lastContactLabel, phoneHref, type ContactSection } from "../../lib/contacts";
import { ContactAvatar } from "./contact-avatar";

export type ContactsView = "list" | "grid";

interface Props {
  sections: ContactSection[];
  view: ContactsView;
  todayKey: string;
  selecting: boolean;
  selected: Set<string>;
  homeName: (homeId: string | null) => string | null;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleFavorite: (contact: ContactCard) => void;
}

/** Letter-grouped contacts as rows or cards, with a jump rail on the right when the list is long. */
export function ContactsList(props: Props): React.ReactElement {
  const { sections, view } = props;
  const total = sections.reduce((sum, section) => sum + section.contacts.length, 0);
  const showRail = sections.length > 3 && total > 12 && sections.every((section) => section.key.length === 1 || section.key === "★");

  return (
    <div className="relative">
      <div className="flex flex-col gap-4 pr-6 sm:pr-7">
        {sections.map((section) => (
          <section key={section.key} id={`contacts-section-${section.key}`} aria-label={section.title} className="scroll-mt-2">
            <h3 className="sticky top-0 z-[1] -mx-1 mb-1 bg-background/85 px-1 py-1 text-2xs font-medium uppercase tracking-wide text-subtle-foreground backdrop-blur">
              {section.title} <span className="font-normal normal-case">· {section.contacts.length}</span>
            </h3>
            {view === "list" ? (
              <ul className="flex flex-col gap-1">
                {section.contacts.map((contact) => (
                  <li key={contact.id}>
                    <ContactRow contact={contact} {...props} />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2">
                {section.contacts.map((contact) => (
                  <li key={contact.id}>
                    <ContactTile contact={contact} {...props} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {showRail ? (
        <nav aria-label="Быстрый переход по буквам" className="absolute inset-y-0 right-0 hidden w-5 sm:block">
          <div className="sticky top-10 flex max-h-[calc(100vh-14rem)] flex-col items-center gap-px overflow-hidden text-2xs text-subtle-foreground">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => document.getElementById(`contacts-section-${section.key}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
                className="rounded px-1 leading-4 hover:bg-white/10 hover:text-foreground"
              >
                {section.key}
              </button>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function useOpen(props: Props, contact: ContactCard): { onClick: () => void; onKeyDown: (event: React.KeyboardEvent) => void } {
  const activate = (): void => (props.selecting ? props.onToggleSelect(contact.id) : props.onOpen(contact.id));
  return {
    onClick: activate,
    onKeyDown: (event) => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        activate();
      }
    }
  };
}

function Quick({ contact }: { contact: ContactCard }): React.ReactElement | null {
  if (!contact.phone && !contact.email) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {contact.phone ? (
        <a href={phoneHref(contact.phone)} onClick={(event) => event.stopPropagation()} aria-label={`Позвонить: ${contact.name}`} title={contact.phone} className="rounded-md p-1.5 text-subtle-foreground hover:bg-white/10 hover:text-foreground">
          <Phone className="h-3.5 w-3.5" />
        </a>
      ) : null}
      {contact.email ? (
        <a href={emailHref(contact.email)} onClick={(event) => event.stopPropagation()} aria-label={`Написать: ${contact.name}`} title={contact.email} className="rounded-md p-1.5 text-subtle-foreground hover:bg-white/10 hover:text-foreground">
          <Mail className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </span>
  );
}

function SelectBox({ checked }: { checked: boolean }): React.ReactElement {
  return (
    <span aria-hidden className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none", checked ? "border-accent bg-accent text-accent-foreground" : "border-border-strong")}>
      {checked ? "✓" : ""}
    </span>
  );
}

function ContactRow(props: Props & { contact: ContactCard }): React.ReactElement {
  const { contact, selecting, selected, todayKey, homeName, onToggleFavorite } = props;
  const handlers = useOpen(props, contact);
  const subtitle = [contact.role, contact.organization, homeName(contact.homeId)].filter(Boolean).join(" · ");
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={selecting ? `Выбрать контакт ${contact.name}` : `Открыть контакт ${contact.name}`}
      aria-pressed={selecting ? selected.has(contact.id) : undefined}
      {...handlers}
      className={cx(
        "group flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        selected.has(contact.id) && "border-accent/40 bg-accent/5"
      )}
    >
      {selecting ? <SelectBox checked={selected.has(contact.id)} /> : null}
      <ContactAvatar name={contact.name} kind={contact.kind} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-body text-foreground">
          <span className="truncate">{contact.name}</span>
          {contact.favorite ? <Star className="h-3 w-3 shrink-0 fill-warning text-warning" aria-label="Избранный" /> : null}
        </p>
        <p className="truncate text-2xs text-subtle-foreground">{subtitle || "Без описания"}</p>
      </div>
      <div className="hidden min-w-0 shrink-0 gap-1 md:flex">
        {contact.tags.slice(0, 2).map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
        {contact.tags.length > 2 ? <Badge>+{contact.tags.length - 2}</Badge> : null}
      </div>
      <div className="hidden w-40 min-w-0 shrink-0 flex-col items-end text-2xs text-muted-foreground lg:flex">
        {contact.phone ? <span className="truncate">{contact.phone}</span> : null}
        <span className="truncate text-subtle-foreground">{contact.lastContactedAt ? `общались ${lastContactLabel(contact.lastContactedAt, todayKey)}` : contact.email}</span>
      </div>
      {selecting ? null : (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            aria-label={contact.favorite ? "Убрать из избранного" : "В избранное"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(contact);
            }}
            className="rounded-md p-1.5 text-subtle-foreground hover:bg-white/10 hover:text-foreground"
          >
            <Star className={cx("h-3.5 w-3.5", contact.favorite && "fill-warning text-warning")} />
          </button>
          <Quick contact={contact} />
        </span>
      )}
    </div>
  );
}

function ContactTile(props: Props & { contact: ContactCard }): React.ReactElement {
  const { contact, selecting, selected, todayKey, homeName } = props;
  const handlers = useOpen(props, contact);
  const subtitle = [contact.role, contact.organization].filter(Boolean).join(" · ") || homeName(contact.homeId) || "";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={selecting ? `Выбрать контакт ${contact.name}` : `Открыть контакт ${contact.name}`}
      aria-pressed={selecting ? selected.has(contact.id) : undefined}
      {...handlers}
      className={cx(
        "relative flex h-full cursor-pointer flex-col items-center gap-2 rounded-2xl border border-border bg-card p-3 text-center transition-[transform,border-color,background-color] hover:-translate-y-0.5 hover:border-border-strong hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        selected.has(contact.id) && "border-accent/50 bg-accent/5"
      )}
    >
      {selecting ? (
        <span className="absolute left-2 top-2">
          <SelectBox checked={selected.has(contact.id)} />
        </span>
      ) : contact.favorite ? (
        <Star className="absolute right-2 top-2 h-3.5 w-3.5 fill-warning text-warning" aria-label="Избранный" />
      ) : null}
      <ContactAvatar name={contact.name} kind={contact.kind} size="lg" />
      <div className="min-w-0 max-w-full">
        <p className="truncate text-body text-foreground">{contact.name}</p>
        <p className="truncate text-2xs text-subtle-foreground">{subtitle || "Без описания"}</p>
      </div>
      <p className="truncate text-2xs text-muted-foreground">{contact.phone || contact.email || lastContactLabel(contact.lastContactedAt, todayKey)}</p>
      {contact.tags.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-1">
          {contact.tags.slice(0, 2).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      ) : null}
      {selecting ? null : <Quick contact={contact} />}
    </div>
  );
}
