"use client";

import { useContactCards, useCreateContactCard, useDeleteContactCard, useHomes, useUpdateContactCard } from "@orion/core-react";
import { contactMatches, type ContactCard, type CreateContactCardInput } from "@orion/shared-types";
import {
  Button,
  Card,
  EmptyState,
  FuseButton,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  Select,
  Sheet,
  Skeleton,
  Textarea,
  useToast
} from "@orion/ui";
import { Mail, Phone, Plus, Search, Trash2, TriangleAlert, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EntityLinksSection } from "../components/entity-links";
import { describeError } from "../lib/error-message";
import { useContactFocusRequest } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";

/**
 * «Контакты» — people and organisations as universal records. A home's
 * contacts (module «Дом») are the same rows with a `homeId`, so they show here
 * too, with their home. The detail sheet carries the shared links + reminders
 * block, which is what makes a contact useful beyond a phone book:
 * «контакт → проект / задача / напоминание».
 */
export function ContactsPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { isEnabled } = useEnabledModules();
  const homesOn = isEnabled("home");
  const contactsQuery = useContactCards(workspaceId);
  const homes = useHomes(homesOn ? workspaceId : undefined).data ?? [];
  const createContact = useCreateContactCard(workspaceId);
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const focus = useContactFocusRequest();
  useEffect(() => {
    if (focus && focus.workspaceId === (workspaceId ?? null)) setOpenId(focus.id);
  }, [focus, workspaceId]);

  const contacts = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);
  const visible = useMemo(() => contacts.filter((contact) => contactMatches(contact, query)), [contacts, query]);
  const homeName = (homeId: string | null): string | null => (homeId ? (homes.find((home) => home.id === homeId)?.name ?? null) : null);
  const open = contacts.find((contact) => contact.id === openId) ?? null;

  async function create(values: CreateContactCardInput): Promise<void> {
    try {
      const created = await createContact.mutateAsync(values);
      setCreating(false);
      setOpenId(created.id);
      toast({ title: "Контакт добавлен", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось добавить контакт", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={UserRound}
        title="Контакты"
        subtitle="Люди и организации — со связями и напоминаниями"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={workspaceId === undefined}>
            <Plus className="h-4 w-4" /> Новый контакт
          </Button>
        }
      >
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            aria-label="Поиск по контактам"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя, роль, телефон или почта"
            className="pl-8"
          />
        </div>
      </PanelHeader>

      <PanelBody measure="wide">
        {workspaceId === undefined || contactsQuery.isLoading ? (
          workspaceLoading || contactsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState icon={UserRound} title="Нет рабочего пространства" description="Контакты живут внутри пространства — создайте его или войдите заново." />
          )
        ) : contactsQuery.isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить контакты"
            description={describeError(contactsQuery.error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void contactsQuery.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="Пока нет контактов"
            description="Сантехник, бухгалтер, клиент, родственник — кто угодно, с кем связаны ваши дела."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новый контакт
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Ничего не нашлось"
            description={`Нет контактов по запросу «${query.trim()}».`}
            action={
              <Button size="sm" variant="outline" onClick={() => setQuery("")}>
                Сбросить поиск
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((contact) => (
              <li key={contact.id}>
                <Card
                  interactive
                  role="button"
                  tabIndex={0}
                  aria-label={`Открыть контакт ${contact.name}`}
                  onClick={() => setOpenId(contact.id)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      setOpenId(contact.id);
                    }
                  }}
                  className="flex min-w-0 items-center gap-3 px-3 py-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-label text-muted-foreground" aria-hidden>
                    {initials(contact.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-foreground">{contact.name}</p>
                    <p className="truncate text-2xs text-subtle-foreground">
                      {[contact.role, homeName(contact.homeId)].filter(Boolean).join(" · ") || "Без роли"}
                    </p>
                  </div>
                  <div className="hidden min-w-0 flex-col items-end text-2xs text-muted-foreground sm:flex">
                    {contact.phone ? <span className="truncate">{contact.phone}</span> : null}
                    {contact.email ? <span className="truncate">{contact.email}</span> : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый контакт" size="sm">
        <ContactForm homes={homesOn ? homes : []} busy={createContact.isPending} submitLabel="Добавить" onCancel={() => setCreating(false)} onSubmit={create} />
      </Modal>

      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.name} width="32rem">
        {open && workspaceId ? (
          <ContactDetail key={open.id} workspaceId={workspaceId} contact={open} homes={homesOn ? homes : []} onDeleted={() => setOpenId(null)} />
        ) : null}
      </Sheet>
    </PanelShell>
  );
}

function ContactDetail({
  workspaceId,
  contact,
  homes,
  onDeleted
}: {
  workspaceId: string;
  contact: ContactCard;
  homes: { id: string; name: string }[];
  onDeleted: () => void;
}): React.ReactElement {
  const update = useUpdateContactCard(workspaceId);
  const remove = useDeleteContactCard(workspaceId);
  const { toast } = useToast();

  async function save(values: CreateContactCardInput): Promise<void> {
    try {
      await update.mutateAsync({ contactId: contact.id, input: values });
      toast({ title: "Контакт сохранён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить контакт", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {contact.phone || contact.email ? (
        <div className="flex flex-wrap gap-2">
          {contact.phone ? (
            <Button size="sm" variant="outline" onClick={() => window.open(`tel:${contact.phone.replace(/[^\d+]/g, "")}`)}>
              <Phone className="h-4 w-4" /> Позвонить
            </Button>
          ) : null}
          {contact.email ? (
            <Button size="sm" variant="outline" onClick={() => window.open(`mailto:${contact.email}`)}>
              <Mail className="h-4 w-4" /> Написать
            </Button>
          ) : null}
        </div>
      ) : null}
      <ContactForm initial={contact} homes={homes} busy={update.isPending} submitLabel="Сохранить" onSubmit={save} />
      <EntityLinksSection workspaceId={workspaceId} type="contact" id={contact.id} />
      <div className="border-t border-border pt-3">
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

function ContactForm({
  initial,
  homes,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: ContactCard;
  homes: { id: string; name: string }[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: CreateContactCardInput) => void | Promise<void>;
  onCancel?: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [homeId, setHomeId] = useState(initial?.homeId ?? "");
  const emailValid = email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = name.trim().length > 0 && emailValid;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        void onSubmit({ name: name.trim(), role: role.trim(), phone: phone.trim(), email: email.trim(), note, homeId: homeId || null });
      }}
    >
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Имя или название
        <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus={!initial} required maxLength={120} />
      </label>
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Кто это
        <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="сантехник, бухгалтер, клиент…" maxLength={80} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Телефон
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" maxLength={40} />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Почта
          <Input value={email} onChange={(event) => setEmail(event.target.value)} inputMode="email" aria-invalid={!emailValid} maxLength={254} />
          {!emailValid ? <span className="text-destructive">Введите корректный email</span> : null}
        </label>
      </div>
      {homes.length > 0 || initial?.homeId ? (
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Дом
          <Select value={homeId} onChange={(event) => setHomeId(event.target.value)}>
            <option value="">Без дома</option>
            {homes.map((home) => (
              <option key={home.id} value={home.id}>
                {home.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Заметка
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} />
      </label>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
        ) : null}
        <Button type="submit" disabled={!valid || busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
