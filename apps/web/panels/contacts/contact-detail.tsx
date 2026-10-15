"use client";

import { useDeleteContactCard, useUpdateContactCard } from "@orion/core-react";
import { CONTACT_KIND_LABEL, contactEmailList, contactPhoneList, nextBirthday, type ContactCard, type CreateContactCardInput } from "@orion/shared-types";
import { Badge, Button, FuseButton, IconButton, SegmentedControl, cx, useToast } from "@orion/ui";
import {
  Archive,
  ArchiveRestore,
  Cake,
  Check,
  Copy,
  Globe,
  Home,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Send,
  Star,
  Trash2,
  type LucideIcon
} from "lucide-react";
import { useState } from "react";
import { EntityLinksSection } from "../../components/entity-links";
import { daysUntilLabel, emailHref, formatBirthday, lastContactLabel, linkHref, linkKind, phoneHref, type LinkKind } from "../../lib/contacts";
import { describeError } from "../../lib/error-message";
import { ContactAvatar } from "./contact-avatar";
import { ContactForm } from "./contact-form";
import { ContactJournal } from "./contact-journal";
import { ContactRelations } from "./contact-relations";

type Tab = "profile" | "journal" | "links";

const LINK_ICON: Record<LinkKind, LucideIcon> = {
  telegram: Send,
  whatsapp: MessageCircle,
  viber: MessageCircle,
  instagram: Globe,
  vk: Globe,
  linkedin: Globe,
  site: Globe,
  other: Globe
};

/** Content of the contact sheet: a read-first profile, the communication journal and the links to other records. */
export function ContactDetail({
  workspaceId,
  contact,
  contacts,
  homes,
  tagSuggestions,
  todayKey,
  onDeleted
}: {
  workspaceId: string;
  contact: ContactCard;
  contacts: ContactCard[];
  homes: { id: string; name: string }[];
  tagSuggestions: string[];
  todayKey: string;
  onDeleted: () => void;
}): React.ReactElement {
  const update = useUpdateContactCard(workspaceId);
  const remove = useDeleteContactCard(workspaceId);
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("profile");
  const [editing, setEditing] = useState(false);

  const homeName = contact.homeId ? (homes.find((home) => home.id === contact.homeId)?.name ?? null) : null;
  const archived = contact.archivedAt !== null;

  function patch(input: Parameters<typeof update.mutate>[0]["input"], success?: string): void {
    update.mutate(
      { contactId: contact.id, input },
      {
        onSuccess: () => success && toast({ title: success, tone: "success" }),
        onError: (error) => toast({ title: "Не удалось сохранить контакт", description: describeError(error), tone: "danger" })
      }
    );
  }

  async function save(values: CreateContactCardInput): Promise<void> {
    try {
      await update.mutateAsync({ contactId: contact.id, input: values });
      setEditing(false);
      toast({ title: "Контакт сохранён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить контакт", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <ContactAvatar name={contact.name} kind={contact.kind} size="lg" />
        <div className="min-w-0 flex-1">
          {/* The name is the sheet's own title; here only who they are. */}
          <p className="break-words text-body text-foreground">{[contact.role, contact.organization].filter(Boolean).join(" · ") || CONTACT_KIND_LABEL[contact.kind]}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {archived ? <Badge tone="warning">В архиве</Badge> : null}
            {homeName ? (
              <Badge>
                <Home className="h-3 w-3" /> {homeName}
              </Badge>
            ) : null}
            {contact.tags.map((tag) => (
              <Badge key={tag} tone="accent">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <IconButton label={contact.favorite ? "Убрать из избранного" : "В избранное"} onClick={() => patch({ favorite: !contact.favorite })}>
          <Star className={cx("h-4 w-4", contact.favorite && "fill-warning text-warning")} />
        </IconButton>
      </div>

      <SegmentedControl<Tab>
        aria-label="Раздел контакта"
        value={tab}
        onChange={setTab}
        options={[
          { value: "profile", label: "Профиль" },
          { value: "journal", label: "Общение" },
          { value: "links", label: "Связи" }
        ]}
      />

      {tab === "profile" ? (
        editing ? (
          <ContactForm initial={contact} homes={homes} tagSuggestions={tagSuggestions} busy={update.isPending} submitLabel="Сохранить" onSubmit={save} onCancel={() => setEditing(false)} />
        ) : (
          <Profile contact={contact} todayKey={todayKey} onEdit={() => setEditing(true)} />
        )
      ) : null}
      {tab === "journal" ? <ContactJournal workspaceId={workspaceId} contact={contact} todayKey={todayKey} /> : null}
      {tab === "links" ? (
        <div className="flex flex-col gap-5">
          <ContactRelations workspaceId={workspaceId} contact={contact} contacts={contacts} />
          <EntityLinksSection workspaceId={workspaceId} type="contact" id={contact.id} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => patch({ archived: !archived }, archived ? "Контакт возвращён" : "Контакт в архиве")}>
          {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} {archived ? "Вернуть из архива" : "В архив"}
        </Button>
        <FuseButton
          label="Удалить контакт"
          armedLabel="Ещё раз — удалить"
          doneLabel="Удалён"
          icon={Trash2}
          onCommit={() =>
            remove.mutate(contact.id, {
              onSuccess: () => {
                toast({ title: "Контакт удалён", tone: "success" });
                onDeleted();
              },
              onError: (error) => toast({ title: "Не удалось удалить контакт", description: describeError(error), tone: "danger" })
            })
          }
        />
      </div>
    </div>
  );
}

function Profile({ contact, todayKey, onEdit }: { contact: ContactCard; todayKey: string; onEdit: () => void }): React.ReactElement {
  const phones = contactPhoneList(contact);
  const emails = contactEmailList(contact);
  const birthday = contact.birthday ? nextBirthday(contact.birthday, todayKey) : null;
  const empty = phones.length + emails.length + contact.links.length === 0 && !contact.address && !contact.birthday && !contact.note;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Изменить
        </Button>
      </div>

      {empty ? <p className="text-label text-subtle-foreground">Пока только имя. Нажмите «Изменить», чтобы добавить телефон, почту, день рождения и заметки.</p> : null}

      {phones.length + emails.length + contact.links.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {phones.map((phone, index) => (
            <Row key={`p${index}`} icon={Phone} label={phone.label || "Телефон"} value={phone.value} href={phoneHref(phone.value)} copyValue={phone.value} />
          ))}
          {emails.map((email, index) => (
            <Row key={`e${index}`} icon={Mail} label={email.label || "Почта"} value={email.value} href={emailHref(email.value)} copyValue={email.value} />
          ))}
          {contact.links.map((link, index) => (
            <Row key={`l${index}`} icon={LINK_ICON[linkKind(link)]} label={link.label || "Ссылка"} value={link.value} href={linkHref(link)} external copyValue={link.value} />
          ))}
        </ul>
      ) : null}

      {contact.address ? (
        <ul>
          <Row icon={MapPin} label="Адрес" value={contact.address} href={`https://yandex.ru/maps/?text=${encodeURIComponent(contact.address)}`} external copyValue={contact.address} />
        </ul>
      ) : null}

      {contact.birthday ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-white/[0.02] p-3">
          <Cake className="mt-0.5 h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
          <div>
            <p className="text-label text-foreground">{formatBirthday(contact.birthday, todayKey)}</p>
            {birthday ? (
              <p className="text-2xs text-subtle-foreground">
                {birthday.daysUntil === 0 ? "Сегодня!" : `Ближайший — ${daysUntilLabel(birthday.daysUntil)}`}
                {birthday.turning !== null ? ` · исполнится ${birthday.turning}` : ""}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="text-2xs text-subtle-foreground">
        Последнее общение: {lastContactLabel(contact.lastContactedAt, todayKey)}
        {contact.contactEveryDays ? ` · связываться раз в ${contact.contactEveryDays} дн.` : ""}
      </p>

      {contact.note ? (
        <div>
          <p className="mb-1 text-2xs text-subtle-foreground">Заметка</p>
          <p className="whitespace-pre-wrap break-words text-label text-muted-foreground">{contact.note}</p>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  href,
  external,
  copyValue
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href: string | null;
  external?: boolean;
  copyValue: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  function copy(): void {
    void navigator.clipboard?.writeText(copyValue).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <li className="group flex items-center gap-3 rounded-lg px-1.5 py-1 hover:bg-white/5">
      <Icon className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-subtle-foreground">{label}</p>
        {href ? (
          <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="block truncate text-label text-accent-text hover:underline">
            {value}
          </a>
        ) : (
          <p className="truncate text-label text-foreground">{value}</p>
        )}
      </div>
      <IconButton label={copied ? "Скопировано" : "Скопировать"} size="sm" className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </IconButton>
    </li>
  );
}
