"use client";

import { useCreateContact, useDeleteContact } from "@orion/core-react";
import { Button, Input, useToast } from "@orion/ui";
import { BookUser, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { EmptyLine, SectionCard, type HomeSectionProps } from "./shared";

/** Who to call for this home: the management company, a plumber, a neighbour. */
export function HomeContacts({ workspaceId, home, overview }: HomeSectionProps): React.ReactElement {
  const { toast } = useToast();
  const create = useCreateContact(workspaceId);
  const remove = useDeleteContact(workspaceId);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ homeId: home.id, input: { name: name.trim(), role: role.trim(), phone: phone.trim(), note: "" } });
      setName("");
      setRole("");
      setPhone("");
    } catch (error) {
      toast({ title: "Не удалось добавить контакт", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <SectionCard title="Контакты" icon={BookUser}>
      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-2">
        <div className="min-w-[9rem] flex-1">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя или организация" aria-label="Имя контакта" />
        </div>
        <div className="w-48 shrink-0">
          <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Кто это (УК, сантехник)" aria-label="Роль" />
        </div>
        <div className="w-40 shrink-0">
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Телефон" inputMode="tel" aria-label="Телефон" />
        </div>
        <Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
          Добавить
        </Button>
      </form>
      {overview.contacts.length === 0 ? (
        <EmptyLine>Контактов пока нет.</EmptyLine>
      ) : (
        <ul className="flex flex-col">
          {overview.contacts.map((contact) => (
            <li key={contact.id} className="group flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-1 py-1 hover:bg-white/5">
              <span className="text-label">{contact.name}</span>
              {contact.role ? <span className="text-2xs text-subtle-foreground">{contact.role}</span> : null}
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`} className="ml-auto font-mono text-label tabular-nums text-accent-text hover:underline">
                  {contact.phone}
                </a>
              ) : (
                <span className="ml-auto" />
              )}
              <button
                type="button"
                aria-label={`Удалить контакт ${contact.name}`}
                onClick={() => remove.mutate({ homeId: home.id, contactId: contact.id }, { onError: (error) => toast({ title: "Не удалось удалить", description: describeError(error), tone: "danger" }) })}
                className="rounded p-0.5 text-subtle-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
