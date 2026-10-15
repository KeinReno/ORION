"use client";

import { useBulkContactCards, useContactCards, useCreateContactCard, useHomes, useUpdateContactCard } from "@orion/core-react";
import type { BulkContactsInput, ContactCard, CreateContactCardInput } from "@orion/shared-types";
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  cx,
  useToast
} from "@orion/ui";
import { Archive, ArchiveRestore, CheckSquare, CopyCheck, FileUp, LayoutGrid, List, MoreHorizontal, Plus, Search, Star, Tag, Trash2, TriangleAlert, UserRound, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "../lib/error-message";
import {
  DEFAULT_CONTACT_FILTERS,
  collectTags,
  filterContacts,
  groupContacts,
  upcomingContactEvents,
  type ContactFilters,
  type ContactScope,
  type ContactSort
} from "../lib/contacts";
import { useContactFocusRequest } from "../lib/panel-bus";
import { useDayKey } from "../lib/use-day-boundary";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { ContactDetail } from "./contacts/contact-detail";
import { ContactForm } from "./contacts/contact-form";
import { ContactsDuplicates, MergeSelectedDialog, useDuplicateGroups } from "./contacts/contacts-duplicates";
import { ContactsIo } from "./contacts/contacts-io";
import { ContactsList, type ContactsView } from "./contacts/contacts-list";
import { ContactsUpcoming } from "./contacts/contacts-upcoming";

const PREFS_KEY = "orion.contacts.prefs.v1";

interface Prefs {
  view: ContactsView;
  sort: ContactSort;
}

function loadPrefs(): Prefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { view: parsed.view === "grid" ? "grid" : "list", sort: parsed.sort === "recent" || parsed.sort === "added" ? parsed.sort : "name" };
  } catch {
    return { view: "list", sort: "name" };
  }
}

/**
 * «Контакты» — people and organisations as a living address book: an
 * alphabetical (or card) list with filters and tags, the nearest birthdays and
 * «пора связаться», a communication journal, relations between people, import
 * and export, duplicate merging. A home's contacts (module «Дом») are the same
 * rows with a `homeId`, so they show here too. The detail sheet carries the
 * shared links + reminders block: «контакт → проект / задача / напоминание».
 */
export function ContactsPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { isEnabled } = useEnabledModules();
  const homesOn = isEnabled("home");
  const contactsQuery = useContactCards(workspaceId);
  const homes = useHomes(homesOn ? workspaceId : undefined).data ?? [];
  const createContact = useCreateContactCard(workspaceId);
  const updateContact = useUpdateContactCard(workspaceId);
  const bulk = useBulkContactCards(workspaceId);
  const { toast } = useToast();
  const todayKey = useDayKey();

  const [filters, setFilters] = useState<ContactFilters>(DEFAULT_CONTACT_FILTERS);
  const [prefs, setPrefs] = useState<Prefs>({ view: "list", sort: "name" });
  useEffect(() => setPrefs(loadPrefs()), []);
  function changePrefs(patch: Partial<Prefs>): void {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* a remembered view is a convenience only */
      }
      return next;
    });
  }

  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showIo, setShowIo] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bulkTag, setBulkTag] = useState("");

  const focus = useContactFocusRequest();
  useEffect(() => {
    if (focus && focus.workspaceId === (workspaceId ?? null)) {
      setOpenId(focus.id);
      // A contact opened from elsewhere may be archived: look at the right list.
      setFilters((current) => ({ ...current, scope: "active" }));
    }
  }, [focus, workspaceId]);

  const contacts = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);
  const active = useMemo(() => contacts.filter((contact) => contact.archivedAt === null), [contacts]);
  const archivedCount = contacts.length - active.length;
  const scoped = useMemo(() => contacts.filter((contact) => (filters.scope === "archived") === (contact.archivedAt !== null)), [contacts, filters.scope]);
  const tags = useMemo(() => collectTags(scoped), [scoped]);
  const visible = useMemo(() => filterContacts(contacts, filters), [contacts, filters]);
  const sections = useMemo(() => groupContacts(visible, prefs.sort), [visible, prefs.sort]);
  const upcoming = useMemo(() => upcomingContactEvents(active, todayKey), [active, todayKey]);
  const duplicateGroups = useDuplicateGroups(active, dismissedVersion);
  const open = contacts.find((contact) => contact.id === openId) ?? null;
  const selectedContacts = contacts.filter((contact) => selected.has(contact.id));
  const filtering = filters.query.trim() !== "" || filters.tag !== null || filters.kind !== "all" || filters.favoritesOnly;
  const tagSuggestions = useMemo(() => collectTags(contacts).map((entry) => entry.tag), [contacts]);
  const homeName = (homeId: string | null): string | null => (homeId ? (homes.find((home) => home.id === homeId)?.name ?? null) : null);

  // Selection never outlives the contacts it points at.
  useEffect(() => {
    setSelected((current) => {
      const alive = new Set([...current].filter((id) => contacts.some((contact) => contact.id === id)));
      return alive.size === current.size ? current : alive;
    });
  }, [contacts]);

  function setScope(scope: ContactScope): void {
    setFilters({ ...DEFAULT_CONTACT_FILTERS, scope });
    setSelected(new Set());
  }

  function toggleSelect(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function endSelecting(): void {
    setSelecting(false);
    setSelected(new Set());
  }

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

  function toggleFavorite(contact: ContactCard): void {
    updateContact.mutate(
      { contactId: contact.id, input: { favorite: !contact.favorite } },
      { onError: (error) => toast({ title: "Не удалось сохранить", description: describeError(error), tone: "danger" }) }
    );
  }

  function runBulk(input: Omit<BulkContactsInput, "ids">, success: string, afterwards?: () => void): void {
    bulk.mutate(
      { ...input, ids: [...selected] },
      {
        onSuccess: (result) => {
          toast({ title: `${success}: ${result.affected}`, tone: "success" });
          afterwards?.();
        },
        onError: (error) => toast({ title: "Не удалось выполнить действие", description: describeError(error), tone: "danger" })
      }
    );
  }

  const kindOptions = [
    { value: "all" as const, label: "Все" },
    { value: "person" as const, label: "Люди" },
    { value: "organization" as const, label: "Организации" }
  ];

  return (
    <PanelShell>
      <PanelHeader
        icon={UserRound}
        title="Контакты"
        subtitle="Люди и организации — со связями, общением и напоминаниями"
        actions={
          <div className="flex items-center gap-1.5">
            <DropdownMenu
              trigger={({ toggle }) => (
                <IconButton label="Ещё" onClick={toggle}>
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              )}
              items={[
                { label: selecting ? "Закончить выбор" : "Выбрать несколько", icon: CheckSquare, onSelect: () => (selecting ? endSelecting() : setSelecting(true)) },
                { label: duplicateGroups.length > 0 ? `Похожие контакты (${duplicateGroups.length})` : "Похожие контакты", icon: CopyCheck, onSelect: () => setShowDuplicates(true) },
                "separator",
                { label: "Импорт и экспорт", icon: FileUp, onSelect: () => setShowIo(true) }
              ]}
            />
            <Button size="sm" onClick={() => setCreating(true)} disabled={workspaceId === undefined}>
              <Plus className="h-4 w-4" /> Новый контакт
            </Button>
          </div>
        }
      >
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            aria-label="Поиск по контактам"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Имя, организация, телефон, почта, тег"
            className="pl-8"
          />
        </div>
      </PanelHeader>

      <PanelBody measure="wide">
        {workspaceId === undefined || contactsQuery.isLoading ? (
          workspaceLoading || contactsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
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
            title="Записная книжка пуста"
            description="Сантехник, бухгалтер, клиент, родственник — кто угодно, с кем связаны ваши дела. Можно загрузить контакты из телефона или Google (.vcf, .csv)."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Новый контакт
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowIo(true)}>
                  <FileUp className="h-4 w-4" /> Импорт
                </Button>
              </div>
            }
          />
        ) : (
          <>
            {filters.scope === "active" && !filtering ? <ContactsUpcoming events={upcoming} onOpen={setOpenId} /> : null}

            <div className="mb-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl<ContactScope>
                  size="sm"
                  aria-label="Какие контакты показывать"
                  value={filters.scope}
                  onChange={setScope}
                  options={[
                    { value: "active", label: `Контакты · ${active.length}` },
                    ...(archivedCount > 0 || filters.scope === "archived" ? [{ value: "archived" as const, label: `Архив · ${archivedCount}` }] : [])
                  ]}
                />
                <SegmentedControl
                  size="sm"
                  aria-label="Тип"
                  value={filters.kind}
                  onChange={(kind) => setFilters({ ...filters, kind })}
                  options={kindOptions}
                />
                <button
                  type="button"
                  aria-pressed={filters.favoritesOnly}
                  onClick={() => setFilters({ ...filters, favoritesOnly: !filters.favoritesOnly })}
                  className={cx("flex items-center gap-1 rounded-lg border px-2 py-1 text-2xs transition-colors", filters.favoritesOnly ? "border-warning/40 bg-warning/10 text-warning" : "border-border text-muted-foreground hover:text-foreground")}
                >
                  <Star className={cx("h-3 w-3", filters.favoritesOnly && "fill-current")} /> Избранные
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <Select value={prefs.sort} onChange={(event) => changePrefs({ sort: event.target.value as ContactSort })} aria-label="Сортировка" className="h-8 w-44 text-xs">
                    <option value="name">По алфавиту</option>
                    <option value="recent">По последнему общению</option>
                    <option value="added">Недавно добавленные</option>
                  </Select>
                  <SegmentedControl<ContactsView>
                    size="sm"
                    aria-label="Вид списка"
                    value={prefs.view}
                    onChange={(view) => changePrefs({ view })}
                    options={[
                      { value: "list", label: <List className="h-3.5 w-3.5" />, ariaLabel: "Списком" },
                      { value: "grid", label: <LayoutGrid className="h-3.5 w-3.5" />, ariaLabel: "Карточками" }
                    ]}
                  />
                </div>
              </div>

              {tags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Фильтр по тегам">
                  <Tag className="h-3.5 w-3.5 text-subtle-foreground" aria-hidden />
                  {tags.slice(0, 14).map(({ tag, count }) => {
                    const on = filters.tag?.toLocaleLowerCase("ru") === tag.toLocaleLowerCase("ru");
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setFilters({ ...filters, tag: on ? null : tag })}
                        className={cx("rounded-full border px-2 py-0.5 text-2xs transition-colors", on ? "border-accent bg-accent/10 text-accent-text" : "border-border text-muted-foreground hover:text-foreground")}
                      >
                        {tag} <span className="text-subtle-foreground">{count}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {selecting ? (
              <div className="sticky top-0 z-[3] mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border-strong bg-card/95 px-3 py-2 backdrop-blur" role="toolbar" aria-label="Действия с выбранными">
                <span className="text-label text-foreground">Выбрано: {selected.size}</span>
                <Button type="button" variant="subtle" size="sm" onClick={() => setSelected(new Set(visible.map((contact) => contact.id)))}>
                  Выбрать все ({visible.length})
                </Button>
                <form
                  className="flex items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (bulkTag.trim() && selected.size > 0) runBulk({ action: "addTag", tag: bulkTag.trim() }, "Тег добавлен", () => setBulkTag(""));
                  }}
                >
                  <Input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} placeholder="Тег для выбранных" aria-label="Тег для выбранных" className="h-8 w-40 text-xs" maxLength={30} />
                  <Button type="submit" variant="outline" size="sm" disabled={!bulkTag.trim() || selected.size === 0}>
                    <Tag className="h-3.5 w-3.5" />
                  </Button>
                </form>
                <Button type="button" variant="outline" size="sm" disabled={selected.size === 0} onClick={() => runBulk({ action: "favorite" }, "В избранном")}>
                  <Star className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => runBulk({ action: filters.scope === "archived" ? "restore" : "archive" }, filters.scope === "archived" ? "Возвращено" : "В архиве", endSelecting)}
                >
                  {filters.scope === "archived" ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  {filters.scope === "archived" ? "Вернуть" : "В архив"}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={selected.size < 2} onClick={() => setMergeOpen(true)}>
                  <Users className="h-3.5 w-3.5" /> Объединить
                </Button>
                <Button type="button" variant="danger" size="sm" disabled={selected.size === 0} onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <IconButton label="Закончить выбор" className="ml-auto" onClick={endSelecting}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
            ) : null}

            {visible.length === 0 ? (
              <EmptyState
                icon={filtering ? Search : Archive}
                title={filtering ? "Ничего не нашлось" : filters.scope === "archived" ? "Архив пуст" : "Нет контактов"}
                description={filtering ? "Под эти условия ничего не подошло." : filters.scope === "archived" ? "Здесь окажутся контакты, которые вы убрали «в архив»." : undefined}
                action={
                  filtering ? (
                    <Button size="sm" variant="outline" onClick={() => setFilters({ ...DEFAULT_CONTACT_FILTERS, scope: filters.scope })}>
                      Сбросить фильтры
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ContactsList
                sections={sections}
                view={prefs.view}
                todayKey={todayKey}
                selecting={selecting}
                selected={selected}
                homeName={homeName}
                onOpen={setOpenId}
                onToggleSelect={toggleSelect}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {filters.scope === "active" && duplicateGroups.length > 0 && !filtering ? (
              <button type="button" onClick={() => setShowDuplicates(true)} className="mt-4 flex items-center gap-2 text-2xs text-subtle-foreground hover:text-foreground">
                <CopyCheck className="h-3.5 w-3.5" /> Найдены похожие контакты <Badge tone="warning">{duplicateGroups.length}</Badge>
              </button>
            ) : null}
          </>
        )}
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый контакт" size="md">
        <ContactForm homes={homesOn ? homes : []} tagSuggestions={tagSuggestions} busy={createContact.isPending} submitLabel="Добавить" onCancel={() => setCreating(false)} onSubmit={create} />
      </Modal>

      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.name} width="34rem">
        {open && workspaceId ? (
          <ContactDetail
            key={open.id}
            workspaceId={workspaceId}
            contact={open}
            contacts={contacts}
            homes={homesOn ? homes : []}
            tagSuggestions={tagSuggestions}
            todayKey={todayKey}
            onDeleted={() => setOpenId(null)}
          />
        ) : null}
      </Sheet>

      <ContactsIo open={showIo} onClose={() => setShowIo(false)} workspaceId={workspaceId} visible={visible} active={active} selected={selectedContacts} />
      <ContactsDuplicates open={showDuplicates} onClose={() => setShowDuplicates(false)} workspaceId={workspaceId} contacts={contacts} groups={duplicateGroups} onDismissed={() => setDismissedVersion((value) => value + 1)} />
      <MergeSelectedDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        workspaceId={workspaceId}
        members={selectedContacts}
        onMerged={() => {
          setMergeOpen(false);
          endSelecting();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Удалить контактов: ${selected.size}?`}
        description="Их журнал общения и связи между контактами удалятся вместе с ними. Чтобы просто убрать из списка, используйте «В архив»."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          runBulk({ action: "delete" }, "Удалено", endSelecting);
        }}
      />
    </PanelShell>
  );
}
