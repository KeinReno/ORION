"use client";

import { useContactRelations, useCreateContactRelation, useDeleteContactRelation } from "@orion/core-react";
import { CONTACT_RELATION_SUGGESTIONS, type ContactCard } from "@orion/shared-types";
import { Button, IconButton, Input, Select, useToast } from "@orion/ui";
import { Plus, Trash2, Users } from "lucide-react";
import { useId, useState } from "react";
import { describeError } from "../../lib/error-message";
import { focusContact } from "../../lib/panel-bus";
import { ContactAvatar } from "./contact-avatar";

/** «Жена», «коллега» — relations between contacts. Shown on both sides; the label reads the same from each. */
export function ContactRelations({ workspaceId, contact, contacts }: { workspaceId: string; contact: ContactCard; contacts: ContactCard[] }): React.ReactElement {
  const relations = useContactRelations(workspaceId, contact.id);
  const create = useCreateContactRelation(workspaceId, contact.id);
  const remove = useDeleteContactRelation(workspaceId, contact.id);
  const { toast } = useToast();
  const listId = useId();

  const [adding, setAdding] = useState(false);
  const [otherId, setOtherId] = useState("");
  const [label, setLabel] = useState("");

  const related = relations.data ?? [];
  const byId = new Map(contacts.map((item) => [item.id, item]));
  const candidates = contacts
    .filter((item) => item.id !== contact.id && !item.archivedAt && !related.some((relation) => relation.otherId === item.id))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  async function add(): Promise<void> {
    if (!otherId) return;
    try {
      await create.mutateAsync({ otherId, label: label.trim() });
      setAdding(false);
      setOtherId("");
      setLabel("");
    } catch (error) {
      toast({ title: "Не удалось связать контакты", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
          <Users className="h-3.5 w-3.5" /> Связанные контакты{related.length > 0 ? ` · ${related.length}` : ""}
        </span>
        <Button type="button" variant="subtle" size="sm" className="h-6 px-2 text-2xs" disabled={candidates.length === 0} onClick={() => setAdding((value) => !value)}>
          <Plus className="h-3.5 w-3.5" /> {adding ? "Отмена" : "Связать"}
        </Button>
      </div>

      {adding ? (
        <form
          className="flex flex-col gap-2 rounded-lg border border-border bg-white/[0.02] p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <datalist id={listId}>
            {CONTACT_RELATION_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <Select value={otherId} onChange={(event) => setOtherId(event.target.value)} aria-label="Контакт">
            <option value="">Выберите контакт…</option>
            {candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <Input list={listId} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Кем приходятся друг другу: супруг(а), коллега…" maxLength={60} aria-label="Связь" />
          <Button type="submit" size="sm" className="self-start" disabled={!otherId || create.isPending}>
            Связать
          </Button>
        </form>
      ) : null}

      {related.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {related.map((relation) => {
            const other = byId.get(relation.otherId);
            return (
              <li key={relation.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5">
                <ContactAvatar name={relation.otherName} kind={other?.kind} size="sm" />
                <button type="button" onClick={() => focusContact(relation.otherId)} className="min-w-0 flex-1 truncate text-left text-label text-foreground hover:underline">
                  {relation.otherName}
                </button>
                {relation.label ? <span className="shrink-0 text-2xs text-subtle-foreground">{relation.label}</span> : null}
                <IconButton label="Убрать связь" size="sm" tone="danger" className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => remove.mutate(relation.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
