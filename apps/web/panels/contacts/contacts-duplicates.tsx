"use client";

import { useMergeContactCards } from "@orion/core-react";
import { contactEmailList, contactPhoneList, findContactDuplicates, type ContactCard, type ContactDuplicateGroup } from "@orion/shared-types";
import { Button, EmptyState, Modal, cx, useToast } from "@orion/ui";
import { CopyCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError } from "../../lib/error-message";
import { ContactAvatar } from "./contact-avatar";

const DISMISSED_KEY = "orion.contacts.dismissed-duplicates";
const REASON_LABEL = { phone: "один телефон", email: "одна почта", name: "то же имя" } as const;

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

const signature = (group: ContactDuplicateGroup): string => [...group.ids].sort().join(",");

/** How filled-in a card is — the fullest one is offered as the survivor of a merge. */
function richness(contact: ContactCard): number {
  return contactPhoneList(contact).length + contactEmailList(contact).length + contact.links.length + contact.tags.length + (contact.birthday ? 1 : 0) + (contact.note ? 1 : 0) + (contact.lastContactedAt ? 1 : 0);
}

/** Groups of contacts that look like one person, with a one-click merge into the fullest card. */
export function useDuplicateGroups(contacts: ContactCard[], dismissedVersion = 0): ContactDuplicateGroup[] {
  return useMemo(() => {
    const dismissed = loadDismissed();
    return findContactDuplicates(contacts).filter((group) => !dismissed.has(signature(group)));
    // `dismissedVersion` re-reads localStorage after a dismissal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, dismissedVersion]);
}

/** Merge of contacts the user ticked by hand (not necessarily detected as duplicates). */
export function MergeSelectedDialog({
  open,
  onClose,
  workspaceId,
  members,
  onMerged
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string | undefined;
  members: ContactCard[];
  onMerged: () => void;
}): React.ReactElement {
  const merge = useMergeContactCards(workspaceId);
  const { toast } = useToast();
  const [chosen, setChosen] = useState<string | null>(null);
  const survivor = chosen && members.some((member) => member.id === chosen) ? chosen : ([...members].sort((a, b) => richness(b) - richness(a))[0]?.id ?? "");

  async function run(): Promise<void> {
    try {
      await merge.mutateAsync({ contactId: survivor, input: { sourceIds: members.map((member) => member.id).filter((id) => id !== survivor) } });
      toast({ title: "Контакты объединены", tone: "success" });
      onMerged();
    } catch (error) {
      toast({ title: "Не удалось объединить", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Объединить ${members.length}`} description="Остальные контакты будут удалены, а их данные, журнал, связи и напоминания перейдут в выбранный." size="sm">
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li key={member.id}>
            <label className={cx("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5", survivor === member.id && "bg-accent/5")}>
              <input type="radio" name="merge-survivor" checked={survivor === member.id} onChange={() => setChosen(member.id)} aria-label={`Оставить ${member.name}`} />
              <ContactAvatar name={member.name} kind={member.kind} size="sm" />
              <span className="min-w-0 flex-1 truncate text-label text-foreground">{member.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onClose}>
          Отмена
        </Button>
        <Button type="button" size="sm" disabled={merge.isPending || members.length < 2} onClick={() => void run()}>
          Объединить
        </Button>
      </div>
    </Modal>
  );
}

export function ContactsDuplicates({
  open,
  onClose,
  workspaceId,
  contacts,
  groups,
  onDismissed
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string | undefined;
  contacts: ContactCard[];
  groups: ContactDuplicateGroup[];
  onDismissed: () => void;
}): React.ReactElement {
  const merge = useMergeContactCards(workspaceId);
  const { toast } = useToast();
  const byId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const [keep, setKeep] = useState<Record<string, string>>({});

  function dismiss(group: ContactDuplicateGroup): void {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...loadDismissed(), signature(group)]));
    } catch {
      /* a dismissal is a convenience only */
    }
    onDismissed();
  }

  async function mergeGroup(group: ContactDuplicateGroup, members: ContactCard[]): Promise<void> {
    const survivor = keep[signature(group)] ?? [...members].sort((a, b) => richness(b) - richness(a))[0]?.id;
    if (!survivor) return;
    try {
      await merge.mutateAsync({ contactId: survivor, input: { sourceIds: members.map((member) => member.id).filter((id) => id !== survivor) } });
      toast({ title: "Контакты объединены", description: "Связи, журнал и напоминания перенесены в оставшийся контакт.", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось объединить", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Похожие контакты" description="Совпадает телефон, почта или имя. Объединение переносит данные, журнал, связи и напоминания в выбранный контакт." size="lg">
      {groups.length === 0 ? (
        <EmptyState icon={CopyCheck} title="Дубликатов нет" description="Похожих контактов не нашлось." />
      ) : (
        <ul className="flex flex-col gap-4">
          {groups.map((group) => {
            const members = group.ids.map((id) => byId.get(id)).filter((member): member is ContactCard => member !== undefined);
            const sig = signature(group);
            const survivor = keep[sig] ?? [...members].sort((a, b) => richness(b) - richness(a))[0]?.id;
            return (
              <li key={sig} className="rounded-xl border border-border bg-white/[0.02] p-3">
                <p className="mb-2 text-2xs text-subtle-foreground">Совпадения: {group.reasons.map((reason) => REASON_LABEL[reason]).join(", ")}</p>
                <ul className="flex flex-col gap-1">
                  {members.map((member) => (
                    <li key={member.id}>
                      <label className={cx("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5", survivor === member.id && "bg-accent/5")}>
                        <input type="radio" name={`keep-${sig}`} checked={survivor === member.id} onChange={() => setKeep((state) => ({ ...state, [sig]: member.id }))} aria-label={`Оставить ${member.name}`} />
                        <ContactAvatar name={member.name} kind={member.kind} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label text-foreground">{member.name}</span>
                          <span className="block truncate text-2xs text-subtle-foreground">{[member.role, member.phone, member.email].filter(Boolean).join(" · ") || "нет данных"}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="subtle" size="sm" onClick={() => dismiss(group)}>
                    Это разные контакты
                  </Button>
                  <Button type="button" size="sm" disabled={merge.isPending} onClick={() => void mergeGroup(group, members)}>
                    Объединить в выбранный
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
