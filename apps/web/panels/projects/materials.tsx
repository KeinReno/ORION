"use client";

import { useCreateEvent, useDocuments, useNotes, useRenameOrMoveDocument, useUploadDocuments } from "@orion/core-react";
import type { ProjectActivity, ProjectDetail } from "@orion/shared-types";
import { Button, DropdownMenu, EmptyState, Input, Modal, PanelSection, SegmentedControl, Skeleton, cx, useToast } from "@orion/ui";
import { CalendarDays, FileText, FolderOpen, Package, Plus, Receipt } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FilterChip } from "../../components/filter-chip";
import { describeError } from "../../lib/error-message";
import { fromDatetimeLocal, relativeTime, toDatetimeLocal } from "../../lib/format";
import { focusDocument, focusEvent, focusNote, focusTransaction, openPanel } from "../../lib/panel-bus";
import { useEnabledModules } from "../../lib/use-enabled-modules";

type Kind = "note" | "file" | "event" | "operation" | "stock";
type Layout = "feed" | "columns";
const LAYOUT_KEY = "orion.project-materials-layout";

const KIND_LABEL: Record<Kind, string> = { note: "Заметка", file: "Файл", event: "Событие", operation: "Операция", stock: "Склад" };
const KIND_PLURAL: Record<Kind, string> = { note: "Заметки", file: "Файлы", event: "События", operation: "Операции", stock: "Склад" };
const KIND_ICON: Record<Kind, React.ComponentType<{ className?: string }>> = {
  note: FileText,
  file: FolderOpen,
  event: CalendarDays,
  operation: Receipt,
  stock: Package
};

interface Material {
  key: string;
  kind: Kind;
  title: string;
  /** ISO instant used for ordering and the "когда" label. */
  at: string;
  open: () => void;
}

function activityKind(type: ProjectActivity["type"]): Kind | null {
  if (type === "event") return "event";
  if (type === "transaction") return "operation";
  if (type === "inventory") return "stock";
  return null;
}

/**
 * Everything attached to a project, in one place: notes, files, events, operations and
 * stock, as one dated feed with a type filter — or as columns by type. The material stays
 * in its own module (a row opens it there); this view only gathers and orders. «Добавить»
 * creates a note, a file or an event already linked to the project.
 *
 * Events, operations and stock have no cheap per-project list on the client, so they come
 * from the project's own activity feed (the most recent ones).
 */
export function ProjectMaterials({
  workspaceId,
  project,
  notesOn,
  documentsOn,
  onAddNote
}: {
  workspaceId: string | undefined;
  project: ProjectDetail;
  notesOn: boolean;
  documentsOn: boolean;
  onAddNote: () => void;
}): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const eventsOn = isEnabled("calendar");
  const { toast } = useToast();
  const { data: notes, isLoading: notesLoading } = useNotes(notesOn ? workspaceId : undefined);
  const { data: documents, isLoading: documentsLoading } = useDocuments(documentsOn ? workspaceId : undefined);
  const upload = useUploadDocuments(workspaceId);
  const attach = useRenameOrMoveDocument(workspaceId);
  const createEvent = useCreateEvent(eventsOn ? workspaceId : undefined);

  const [layout, setLayout] = useState<Layout>("feed");
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [eventOpen, setEventOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem(LAYOUT_KEY) === "columns") setLayout("columns");
    } catch {
      /* a remembered layout is a convenience only */
    }
  }, []);
  function chooseLayout(next: Layout): void {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const items = useMemo<Material[]>(() => {
    const out: Material[] = [];
    for (const note of notes ?? []) {
      if (note.projectId !== project.id) continue;
      out.push({ key: `note:${note.id}`, kind: "note", title: note.title || "Без заголовка", at: note.editedAt ?? note.updatedAt, open: () => focusNote(note.id) });
    }
    for (const doc of documents ?? []) {
      if (doc.projectId !== project.id || doc.kind !== "file" || doc.deletedAt) continue;
      out.push({ key: `file:${doc.id}`, kind: "file", title: doc.name, at: doc.updatedAt, open: () => focusDocument(doc.id) });
    }
    for (const item of project.activity) {
      const kind = activityKind(item.type);
      if (!kind) continue;
      out.push({
        key: `${item.type}:${item.id}`,
        kind,
        title: item.title,
        at: item.at,
        open: () => {
          if (item.type === "event") focusEvent(item.id);
          else if (item.type === "transaction") focusTransaction(item.id);
          else openPanel("inventory");
        }
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [notes, documents, project.activity, project.id]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { note: 0, file: 0, event: 0, operation: 0, stock: 0 };
    for (const item of items) c[item.kind] += 1;
    return c;
  }, [items]);
  const kinds = (Object.keys(counts) as Kind[]).filter((kind) => counts[kind] > 0);
  const visible = filter === "all" ? items : items.filter((item) => item.kind === filter);
  const loading = (notesOn && notesLoading) || (documentsOn && documentsLoading);

  async function onFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    try {
      const created = await upload.mutateAsync({ parentId: null, files: [...files] });
      // The upload lands in the document root; linking it to the project is a second, small step.
      await Promise.all(created.map((doc) => attach.mutateAsync({ id: doc.id, input: { projectId: project.id } })));
      toast({ title: created.length === 1 ? "Файл добавлен" : `Файлов добавлено: ${created.length}`, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось загрузить файл", description: describeError(error), tone: "danger" });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function addEvent(title: string, startIso: string, endIso: string): Promise<void> {
    try {
      await createEvent.mutateAsync({
        title,
        description: "",
        startAt: startIso,
        endAt: endIso,
        allDay: false,
        reminders: [],
        projectId: project.id
      });
      setEventOpen(false);
      toast({ title: "Событие создано", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать событие", description: describeError(error), tone: "danger" });
    }
  }

  const addItems = [
    ...(notesOn ? [{ label: "Заметку", icon: FileText, onSelect: onAddNote }] : []),
    ...(documentsOn ? [{ label: "Файл…", icon: FolderOpen, onSelect: () => fileInput.current?.click() }] : []),
    ...(eventsOn ? [{ label: "Событие…", icon: CalendarDays, onSelect: () => setEventOpen(true) }] : [])
  ];
  const addMenu =
    addItems.length > 0 ? (
      <DropdownMenu
        align="end"
        trigger={({ toggle }) => (
          <Button size="sm" onClick={toggle}>
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        )}
        items={addItems}
      />
    ) : null;

  return (
    <div className="space-y-4">
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => void onFiles(event.target.files)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<Layout>
          aria-label="Вид материалов"
          size="sm"
          value={layout}
          onChange={chooseLayout}
          options={[
            { value: "feed", label: "Лента" },
            { value: "columns", label: "Колонки" }
          ]}
        />
        {addMenu}
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Материалов пока нет"
          description="Заметки, файлы и события, привязанные к проекту, соберутся здесь."
          action={addMenu ?? undefined}
        />
      ) : layout === "feed" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Тип материала">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              Все · {items.length}
            </FilterChip>
            {kinds.map((kind) => (
              <FilterChip key={kind} active={filter === kind} onClick={() => setFilter(kind)}>
                {KIND_PLURAL[kind]} · {counts[kind]}
              </FilterChip>
            ))}
          </div>
          <ul className="flex flex-col">
            {visible.map((item) => (
              <MaterialRow key={item.key} item={item} showKind />
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 [@container(min-width:896px)]:grid-cols-3">
          {notesOn ? <Column title="Заметки" items={items.filter((i) => i.kind === "note")} empty="Заметок, привязанных к проекту, нет." /> : null}
          {documentsOn ? <Column title="Файлы" items={items.filter((i) => i.kind === "file")} empty="Файлов, привязанных к проекту, нет." /> : null}
          <Column
            title="События и операции"
            items={items.filter((i) => i.kind === "event" || i.kind === "operation" || i.kind === "stock")}
            empty="Событий и операций пока нет."
            showKind
          />
        </div>
      )}

      <Modal open={eventOpen} onClose={() => setEventOpen(false)} title="Новое событие проекта" size="sm">
        {eventOpen ? <EventForm busy={createEvent.isPending} onCancel={() => setEventOpen(false)} onSubmit={addEvent} /> : null}
      </Modal>
    </div>
  );
}

function Column({ title, items, empty, showKind }: { title: string; items: Material[]; empty: string; showKind?: boolean }): React.ReactElement {
  return (
    <PanelSection title={`${title} · ${items.length}`}>
      {items.length === 0 ? (
        <p className="text-label text-subtle-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <MaterialRow key={item.key} item={item} showKind={showKind} />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function MaterialRow({ item, showKind }: { item: Material; showKind?: boolean }): React.ReactElement {
  const Icon = KIND_ICON[item.kind];
  return (
    <li>
      <button
        type="button"
        onClick={item.open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-row text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-muted-foreground")}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-label text-foreground">{item.title}</span>
        {showKind ? <span className="shrink-0 text-micro text-subtle-foreground">{KIND_LABEL[item.kind]}</span> : null}
        <span className="shrink-0 text-micro text-subtle-foreground">{relativeTime(item.at)}</span>
      </button>
    </li>
  );
}

function EventForm({
  busy,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (title: string, startIso: string, endIso: string) => void | Promise<void>;
}): React.ReactElement {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => {
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return toDatetimeLocal(next.toISOString());
  });
  const [end, setEnd] = useState(() => {
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 2);
    return toDatetimeLocal(next.toISOString());
  });
  const startIso = fromDatetimeLocal(start);
  const endIso = fromDatetimeLocal(end);
  const valid = title.trim().length > 0 && startIso !== null && endIso !== null && Date.parse(endIso) > Date.parse(startIso);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (valid && startIso && endIso) void onSubmit(title.trim(), startIso, endIso);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название" aria-label="Название" autoFocus required />
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Начало
        <Input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required />
      </label>
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Конец
        <Input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required />
      </label>
      {endIso && startIso && Date.parse(endIso) <= Date.parse(startIso) ? (
        <p className="text-label text-destructive">Конец должен быть позже начала</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !valid}>
          Создать
        </Button>
      </div>
    </form>
  );
}
