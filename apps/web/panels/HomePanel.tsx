"use client";

import { useCreateHome, useDeleteHome, useHomeOverview, useHomes, useUpdateHome } from "@orion/core-react";
import { HOME_KINDS, HOME_KIND_LABEL, type Home, type HomeKind } from "@orion/shared-types";
import { Button, ConfirmDialog, DropdownMenu, EmptyState, IconButton, Input, Modal, PanelBody, PanelHeader, PanelShell, Select, Skeleton, Textarea, cx, useToast } from "@orion/ui";
import { HomeIcon, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { describeError } from "../lib/error-message";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { HomeActivity } from "./home/home-activity";
import { HomeContacts } from "./home/home-contacts";
import { HomeMeters } from "./home/home-meters";
import { HomePayments } from "./home/home-payments";
import { HomeShopping } from "./home/home-shopping";
import { HomeTasks } from "./home/home-tasks";
import { HomeThings } from "./home/home-things";

const SELECTED_KEY = "orion.home.selected";

/**
 * «Дом»: one page per home — chores and errands, what to buy, payments, meters, things, contacts.
 * Everything is added right here; the records still belong to Tasks / Lists / Finance / Inventory
 * (they show up there too), the home only points at them. A block of a module that is off is hidden.
 */
export function HomePanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { isEnabled } = useEnabledModules();
  const { toast } = useToast();
  const { data: homes, isLoading } = useHomes(workspaceId);
  const createHome = useCreateHome(workspaceId);
  const updateHome = useUpdateHome(workspaceId);
  const deleteHome = useDeleteHome(workspaceId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    try {
      setSelectedId(localStorage.getItem(`${SELECTED_KEY}:${workspaceId}`));
    } catch {
      /* a remembered home is a convenience only */
    }
  }, [workspaceId]);
  const home = (homes ?? []).find((h) => h.id === selectedId) ?? (homes ?? [])[0] ?? null;
  function select(id: string): void {
    setSelectedId(id);
    try {
      localStorage.setItem(`${SELECTED_KEY}:${workspaceId}`, id);
    } catch {
      /* ignore */
    }
  }

  const { data: overview, isLoading: overviewLoading } = useHomeOverview(workspaceId, home?.id);

  async function submit(values: { name: string; kind: HomeKind; note: string }): Promise<void> {
    try {
      if (dialog === "edit" && home) {
        await updateHome.mutateAsync({ homeId: home.id, input: values });
      } else {
        const created = await createHome.mutateAsync(values);
        select(created.id);
      }
      setDialog(null);
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={HomeIcon}
        title="Дом"
        subtitle={home ? `${HOME_KIND_LABEL[home.kind]} · ${home.name}` : undefined}
        actions={
          <>
            <Button size="sm" onClick={() => setDialog("create")}>
              <Plus className="h-4 w-4" /> Новый дом
            </Button>
            {home ? (
              <DropdownMenu
                align="end"
                trigger={({ toggle }) => (
                  <IconButton label="Действия с домом" size="sm" onClick={toggle}>
                    <MoreHorizontal className="h-4 w-4" />
                  </IconButton>
                )}
                items={[
                  { label: "Изменить", icon: Pencil, onSelect: () => setDialog("edit") },
                  "separator" as const,
                  { label: "Удалить дом", icon: Trash2, tone: "danger" as const, onSelect: () => setConfirmDelete(true) }
                ]}
              />
            ) : null}
          </>
        }
      />
      <PanelBody className="space-y-4 [container-type:inline-size]">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : !home ? (
          <EmptyState
            icon={HomeIcon}
            title="Домов пока нет"
            description="Заведите квартиру, дом, дачу или машину — на странице объекта будут дела, покупки, платежи, счётчики, вещи и контакты."
            action={
              <Button size="sm" onClick={() => setDialog("create")}>
                <Plus className="h-4 w-4" /> Новый дом
              </Button>
            }
          />
        ) : (
          <>
            {(homes ?? []).length > 1 ? (
              <div role="tablist" aria-label="Дома" className="flex flex-wrap gap-1">
                {(homes ?? []).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    role="tab"
                    aria-selected={h.id === home.id}
                    onClick={() => select(h.id)}
                    className={cx("rounded-lg px-3 py-1.5 text-label transition-colors", h.id === home.id ? "bg-accent/20 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            ) : null}
            {home.note ? <p className="max-w-3xl whitespace-pre-wrap text-label text-muted-foreground">{home.note}</p> : null}
            {overviewLoading || !overview ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <div className="grid gap-4 [@container(min-width:900px)]:grid-cols-2">
                {isEnabled("tasks") ? <HomeTasks workspaceId={workspaceId} home={home} overview={overview} /> : null}
                {isEnabled("lists") ? <HomeShopping workspaceId={workspaceId} home={home} overview={overview} /> : null}
                {isEnabled("finance") ? <HomePayments workspaceId={workspaceId} home={home} overview={overview} /> : null}
                <HomeMeters workspaceId={workspaceId} home={home} overview={overview} />
                {isEnabled("inventory") ? <HomeThings workspaceId={workspaceId} home={home} overview={overview} /> : null}
                <HomeContacts workspaceId={workspaceId} home={home} overview={overview} />
                <HomeActivity workspaceId={workspaceId} home={home} overview={overview} />
              </div>
            )}
          </>
        )}
      </PanelBody>

      <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog === "edit" ? "Изменить дом" : "Новый дом"} size="sm">
        {dialog ? <HomeForm key={dialog + (home?.id ?? "")} initial={dialog === "edit" ? home : null} busy={createHome.isPending || updateHome.isPending} onSubmit={submit} onCancel={() => setDialog(null)} /> : null}
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить дом?"
        description={home ? `«${home.name}»: счётчики удалятся. Контакты, дела, списки, вещи и платежи останутся в своих разделах, только потеряют привязку к дому.` : undefined}
        onConfirm={() => {
          const id = home?.id;
          setConfirmDelete(false);
          if (id) deleteHome.mutate(id, { onError: (error) => toast({ title: "Не удалось удалить", description: describeError(error), tone: "danger" }) });
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </PanelShell>
  );
}

function HomeForm({
  initial,
  busy,
  onSubmit,
  onCancel
}: {
  initial: Home | null;
  busy: boolean;
  onSubmit: (values: { name: string; kind: HomeKind; note: string }) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<HomeKind>(initial?.kind ?? "flat");
  const [note, setNote] = useState(initial?.note ?? "");
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) void onSubmit({ name: name.trim(), kind, note });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Название, например «Квартира»" aria-label="Название" autoFocus maxLength={120} />
      <Select aria-label="Вид" value={kind} onChange={(event) => setKind(event.target.value as HomeKind)}>
        {HOME_KINDS.map((k) => (
          <option key={k} value={k}>
            {HOME_KIND_LABEL[k]}
          </option>
        ))}
      </Select>
      <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Заметка (необязательно): адрес, коды, всё, что стоит держать рядом" aria-label="Заметка" rows={3} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {initial ? "Сохранить" : "Создать"}
        </Button>
      </div>
    </form>
  );
}
