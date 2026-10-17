"use client";

import { useCreateList, useListTemplates, useLists, useReorderLists } from "@orion/core-react";
import {
  LIST_KINDS,
  LIST_KIND_LABELS,
  listProgress,
  sortListItems,
  type List,
  type ListKind
} from "@orion/shared-types";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Select,
  Skeleton,
  cx,
  useToast
} from "@orion/ui";
import { ExternalLink, FilePlus2, ListChecks, Plus, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError } from "../lib/error-message";
import { formatMoney } from "../lib/format";
import { openList } from "../lib/panel-bus";
import { ReplicaBanner } from "../components/replica-banner";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useRowDnd } from "../lib/use-row-dnd";
import { ItemAdder } from "./lists/item-adder";
import { ListItemRow } from "./lists/list-item-row";
import { ListMenu } from "./lists/list-menu";
import { useListActions } from "./lists/use-list-actions";

type Tab = "active" | "templates" | "archive";

/**
 * Списки: lightweight checklists (shopping, to-dos, packing) — deliberately simpler than Tasks (no
 * status/recurrence) and simpler than Habits (no schedule/streak). The board shows every list as a card
 * with a preview; a list opens as its own tab (`openList`) for the full view. One cache family —
 * `["lists", ws, …]` — carries each list with its items nested, so every mutation invalidates the same
 * key; item mutations additionally patch it optimistically so the checkbox answers instantly.
 *
 * Lists belong to the whole workspace: everyone sees and ticks the same ones, and the board re-reads
 * them every few seconds. Order of the cards is manual (drag them).
 */
export function ListsPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("active");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ListKind | "all">("all");
  const [creating, setCreating] = useState<{ templateId?: string } | null>(null);

  const listsQuery = useLists(workspaceId, true);
  const templatesQuery = useListTemplates(workspaceId);
  const reorder = useReorderLists(workspaceId);

  const all = listsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const active = all.filter((list) => !list.archivedAt);
  const archived = all.filter((list) => list.archivedAt);

  const shown = useMemo(() => {
    const source = tab === "active" ? active : tab === "archive" ? archived : templates.filter((list) => !list.archivedAt);
    const needle = query.trim().toLocaleLowerCase("ru");
    return source.filter(
      (list) =>
        (kindFilter === "all" || list.kind === kindFilter) &&
        (needle === "" || list.name.toLocaleLowerCase("ru").includes(needle) || list.items.some((item) => item.label.toLocaleLowerCase("ru").includes(needle)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, templates, tab, query, kindFilter]);

  const filtering = query.trim() !== "" || kindFilter !== "all";

  function moveCard(movedId: string, beforeId: string | null): void {
    const ids = shown.map((list) => list.id).filter((id) => id !== movedId);
    const at = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, movedId);
    reorder.mutate({ ids }, { onError: (error) => toast({ title: "Не удалось изменить порядок", description: describeError(error), tone: "danger" }) });
  }
  const dnd = useRowDnd("lists-board", (movedId, beforeId) => moveCard(movedId, beforeId));

  const loading = workspaceId !== undefined && (listsQuery.isLoading || templatesQuery.isLoading);
  const empty = all.length === 0 && templates.length === 0;

  return (
    <PanelShell>
      <PanelHeader
        icon={ListChecks}
        title="Списки"
        subtitle="Покупки, дела, сборы — что угодно с галочками"
        actions={
          <Button size="sm" onClick={() => setCreating({})} disabled={workspaceId === undefined}>
            <Plus className="h-4 w-4" /> Новый список
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<Tab>
            size="sm"
            aria-label="Раздел списков"
            value={tab}
            onChange={setTab}
            options={[
              { value: "active", label: `Активные${active.length ? ` · ${active.length}` : ""}` },
              { value: "templates", label: `Шаблоны${templates.length ? ` · ${templates.length}` : ""}` },
              { value: "archive", label: `Архив${archived.length ? ` · ${archived.length}` : ""}` }
            ]}
          />
          <div className="relative min-w-40 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти список или пункт" className="h-8 pl-8 text-xs" disabled={workspaceId === undefined} />
          </div>
          <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ListKind | "all")} className="h-8 w-auto text-xs" aria-label="Вид списка">
            <option value="all">Все виды</option>
            {LIST_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LIST_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
        </div>
      </PanelHeader>

      <ReplicaBanner workspaceId={workspaceId} />
      <PanelBody className="[container-type:inline-size]">
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-32 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState icon={ListChecks} title="Нет рабочего пространства" description="Списки живут внутри пространства — создайте его или войдите заново." />
          )
        ) : loading ? (
          <div className="grid grid-cols-1 gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:896px)]:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-40 w-full" />
            ))}
          </div>
        ) : listsQuery.isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить списки"
            description={describeError(listsQuery.error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void listsQuery.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : empty ? (
          <EmptyState
            icon={ListChecks}
            title="Списков пока нет"
            description="Заведите первый — например, «Продукты»."
            action={
              <Button size="sm" onClick={() => setCreating({})}>
                <Plus className="h-4 w-4" /> Новый список
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={tab === "templates" ? FilePlus2 : ListChecks}
            title={
              filtering
                ? "Ничего не найдено"
                : tab === "active"
                  ? "Нет активных списков"
                  : tab === "templates"
                    ? "Шаблонов пока нет"
                    : "В архиве пусто"
            }
            description={
              filtering
                ? "Измените запрос или вид списка."
                : tab === "templates"
                  ? "Откройте меню «⋯» у списка и выберите «Сохранить как шаблон» — из него потом создаётся новый список."
                  : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:896px)]:grid-cols-3">
            {shown.map((list) => (
              <div
                key={list.id}
                {...(tab === "active" && !filtering ? dnd.bind(list.id) : {})}
                className={cx(
                  "relative transition-opacity",
                  dnd.dragId === list.id && "opacity-40",
                  dnd.overId === list.id && "before:absolute before:-left-1.5 before:inset-y-0 before:w-0.5 before:rounded before:bg-accent"
                )}
              >
                <ListCard
                  list={list}
                  workspaceId={workspaceId}
                  mode={tab}
                  onCreateFromTemplate={() => setCreating({ templateId: list.id })}
                />
              </div>
            ))}
          </div>
        )}
      </PanelBody>

      <NewListModal
        open={creating !== null}
        workspaceId={workspaceId}
        templates={templates.filter((list) => !list.archivedAt)}
        initialTemplateId={creating?.templateId}
        onClose={() => setCreating(null)}
        onCreated={(list) => {
          setCreating(null);
          setTab("active");
          openList(list.id, list.name);
        }}
      />
    </PanelShell>
  );
}

function NewListModal({
  open,
  workspaceId,
  templates,
  initialTemplateId,
  onClose,
  onCreated
}: {
  open: boolean;
  workspaceId: string | undefined;
  templates: List[];
  initialTemplateId?: string;
  onClose: () => void;
  onCreated: (list: List) => void;
}): React.ReactElement {
  const createList = useCreateList(workspaceId);
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ListKind | "">("");
  const [templateId, setTemplateId] = useState("");

  // Re-seed each time the dialog opens (a template button pre-selects its template and suggests its name).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (initialTemplateId ?? "") : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (seedKey !== null) {
      setTemplateId(seedKey);
      setName(templates.find((t) => t.id === seedKey)?.name.replace(/ — шаблон$/, "") ?? "");
      setKind("");
    }
  }

  function submit(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    createList.mutate(
      { name: trimmed, ...(kind ? { kind } : {}), ...(templateId ? { templateId } : {}) },
      {
        onSuccess: (list) => {
          setName("");
          toast({ title: "Список создан", tone: "success" });
          onCreated(list);
        },
        onError: (error) => toast({ title: "Не удалось создать список", description: describeError(error), tone: "danger" })
      }
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый список"
      footer={
        <>
          <Button variant="subtle" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" onClick={submit} disabled={!name.trim()} status={createList.isPending ? "pending" : "idle"}>
            Создать
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Название списка" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Вид</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ListKind | "")}>
              <option value="">{templateId ? "Как у шаблона" : LIST_KIND_LABELS.general}</option>
              {LIST_KINDS.map((value) => (
                <option key={value} value={value}>
                  {LIST_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Из шаблона</span>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={templates.length === 0}>
              <option value="">{templates.length === 0 ? "Шаблонов нет" : "Пустой список"}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.items.length})
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>
    </Modal>
  );
}

const PREVIEW_LIMIT = 6;

/** One list's card: name, kind, progress, a preview of the entries (or all of them), a quick-add line. */
function ListCard({
  list,
  workspaceId,
  mode,
  onCreateFromTemplate
}: {
  list: List;
  workspaceId: string;
  mode: Tab;
  onCreateFromTemplate: () => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const actions = useListActions(workspaceId, list);

  // Unchecked first (what's left to do), then manual order — display-only, nothing persisted.
  const sortedItems = useMemo(() => sortListItems(list.items), [list.items]);
  const progress = listProgress(list.items);
  const visible = expanded ? sortedItems : sortedItems.slice(0, PREVIEW_LIMIT);
  const hidden = sortedItems.length - visible.length;
  const done = progress.total > 0 && progress.checked === progress.total;
  const editable = mode === "active";

  return (
    <div className={cx("flex flex-col rounded-xl border border-border p-3", mode === "archive" && "opacity-80")}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => openList(list.id, list.name)}
          className="min-w-0 truncate text-left text-title text-foreground hover:underline"
          title="Открыть список"
        >
          {list.name}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <ItemOpenButton onOpen={() => openList(list.id, list.name)} />
          <ListMenu workspaceId={workspaceId} list={list} />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-subtle-foreground">
        {list.kind !== "general" ? <Badge tone="neutral">{LIST_KIND_LABELS[list.kind]}</Badge> : null}
        {progress.total > 0 ? (
          <span className={cx(done && "text-success")}>
            {progress.checked} из {progress.total}
          </span>
        ) : null}
        {progress.priceMinor > 0 ? <span>{formatMoney(progress.priceMinor)}</span> : null}
      </div>
      {progress.total > 0 ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className={cx("h-full rounded-full transition-[width]", done ? "bg-success" : "bg-accent")} style={{ width: `${(progress.checked / progress.total) * 100}%` }} />
        </div>
      ) : null}

      {sortedItems.length === 0 ? (
        <div className="mt-2">
          <EmptyState icon={ListChecks} title="Пусто" description={editable ? "Добавьте первый пункт." : undefined} />
        </div>
      ) : (
        <ul className="mt-2 space-y-1">
          {visible.map((item) => (
            <li key={item.id}>
              <ListItemRow
                workspaceId={workspaceId}
                listId={list.id}
                item={item}
                itemBridge={actions.itemBridge}
                compact
                onToggle={() => actions.toggle(item)}
                onDelete={() => actions.remove(item)}
              />
            </li>
          ))}
        </ul>
      )}

      {sortedItems.length > PREVIEW_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 self-start text-micro text-subtle-foreground hover:text-foreground"
        >
          {expanded ? "Свернуть" : `Показать все (ещё ${hidden})`}
        </button>
      ) : null}

      {editable ? (
        <div className="mt-2">
          <ItemAdder workspaceId={workspaceId} listId={list.id} compact />
        </div>
      ) : null}

      {mode === "templates" ? (
        <Button size="sm" className="mt-2 self-start" onClick={onCreateFromTemplate}>
          <FilePlus2 className="h-4 w-4" /> Создать список
        </Button>
      ) : null}

      {editable && progress.checked > 0 ? (
        <button type="button" onClick={actions.clearDone} className="mt-2 self-start text-micro text-subtle-foreground hover:text-foreground">
          {`Очистить отмеченные (${progress.checked}) — можно отменить`}
        </button>
      ) : null}
    </div>
  );
}

function ItemOpenButton({ onOpen }: { onOpen: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Открыть список целиком"
      title="Открыть список целиком"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
    >
      <ExternalLink className="h-4 w-4" />
    </button>
  );
}
