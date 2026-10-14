"use client";

import { useCreateHome, useDeleteHome, useHomeOverview, useHomes, useUpdateHome } from "@orion/core-react";
import { HOME_KINDS, HOME_KIND_LABEL, type Home, type HomeKind } from "@orion/shared-types";
import { Button, ConfirmDialog, DropdownMenu, EmptyState, IconButton, Input, Modal, PanelBody, PanelHeader, PanelShell, Select, Skeleton, Textarea, cx, useToast } from "@orion/ui";
import { ArrowLeft, ArrowRight, ClipboardList, Gauge, HomeIcon, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { describeError } from "../lib/error-message";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";
import { openPanel } from "../lib/panel-bus";
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
  const { data: homes, isLoading, isError: homesError, refetch: refetchHomes } = useHomes(workspaceId);
  const createHome = useCreateHome(workspaceId);
  const updateHome = useUpdateHome(workspaceId);
  const deleteHome = useDeleteHome(workspaceId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"family" | "object">("family");
  const [activeTab, setActiveTab] = useState("overview");
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
    setView("object");
    setActiveTab("overview");
    try {
      localStorage.setItem(`${SELECTED_KEY}:${workspaceId}`, id);
    } catch {
      /* ignore */
    }
  }

  const { data: overview, isLoading: overviewLoading, isError: overviewError, refetch: refetchOverview } = useHomeOverview(workspaceId, home?.id);
  const pluginTabs = useSlotContributions("home.object.tabs");
  const tabs = [
    { id: "overview", label: "Обзор" },
    ...pluginTabs.map((p) => ({ id: p.meta?.tabId ?? p.pluginId, label: p.meta?.label ?? p.pluginId })),
    { id: "meters", label: "Счётчики" },
    { id: "tasks", label: "Дела" },
    { id: "related", label: "Связанное" }
  ];
  const displayedTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : "overview";

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
        subtitle={view === "object" && home ? `${HOME_KIND_LABEL[home.kind]} · ${home.name}` : "Семейный центр"}
        actions={
          <>
            <Button size="sm" onClick={() => setDialog("create")}>
              <Plus className="h-4 w-4" /> Новый объект
            </Button>
            {view === "object" && home ? (
              <DropdownMenu
                align="end"
                trigger={({ toggle }) => (
                  <IconButton label="Действия с объектом" size="sm" onClick={toggle}>
                    <MoreHorizontal className="h-4 w-4" />
                  </IconButton>
                )}
                items={[
                  { label: "Изменить", icon: Pencil, onSelect: () => setDialog("edit") },
                  "separator" as const,
                  { label: "Удалить объект", icon: Trash2, tone: "danger" as const, onSelect: () => setConfirmDelete(true) }
                ]}
              />
            ) : null}
          </>
        }
      />
      <PanelBody className="space-y-5 [container-type:inline-size]">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : homesError ? (
          <EmptyState icon={HomeIcon} title="Не удалось загрузить Дом" description="Проверьте соединение и попробуйте ещё раз." action={<Button size="sm" onClick={() => void refetchHomes()}>Повторить</Button>} />
        ) : view === "family" || !home ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-2xs uppercase tracking-[0.14em] text-subtle-foreground">Семья и дом</p>
                <h2 className="mt-1 text-xl font-semibold text-foreground">Всё важное рядом</h2>
                <p className="mt-1 text-label text-muted-foreground">Объекты, дела и повседневные планы в одном пространстве.</p>
              </div>
            </div>
            {(homes ?? []).length === 0 ? (
              <EmptyState icon={HomeIcon} title="Добавьте первый объект" description="Квартира, дом, дача или машина — начните с того, что хотите вести в Орионе." action={<Button size="sm" onClick={() => setDialog("create")}><Plus className="h-4 w-4" /> Добавить объект</Button>} />
            ) : (
              <div className="grid gap-3 [@container(min-width:680px)]:grid-cols-2 [@container(min-width:1050px)]:grid-cols-3">
                {(homes ?? []).map((item) => (
                  <button key={item.id} type="button" onClick={() => select(item.id)} className="group flex min-h-32 flex-col items-start rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-accent/60 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    <span className="flex w-full items-center gap-2 text-2xs text-muted-foreground"><HomeIcon className="h-4 w-4" aria-hidden />{HOME_KIND_LABEL[item.kind]}<ArrowRight className="ml-auto h-4 w-4 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
                    <span className="mt-5 text-title text-foreground">{item.name}</span>
                    {item.note ? <span className="mt-1 line-clamp-1 text-2xs text-subtle-foreground">{item.note}</span> : null}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-3 [@container(min-width:680px)]:grid-cols-3">
              {isEnabled("tasks") ? <FamilyShortcut icon={ClipboardList} title="Дела" description="Задачи всей семьи" onClick={() => openPanel("tasks")} /> : null}
              {isEnabled("lists") ? <FamilyShortcut icon={Link2} title="Списки" description="Покупки и планы" onClick={() => openPanel("lists")} /> : null}
              {isEnabled("finance") ? <FamilyShortcut icon={Gauge} title="Финансы" description="Счета и расходы" onClick={() => openPanel("finance")} /> : null}
            </div>
          </>
        ) : (
          <>
            <button type="button" className="inline-flex items-center gap-1 text-label text-muted-foreground hover:text-foreground" onClick={() => setView("family")}><ArrowLeft className="h-4 w-4" aria-hidden /> Все объекты</button>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15"><HomeIcon className="h-5 w-5 text-accent" aria-hidden /></div>
              <div className="min-w-0"><h2 className="text-xl font-semibold text-foreground">{home.name}</h2><p className="text-2xs text-muted-foreground">{HOME_KIND_LABEL[home.kind]}</p></div>
            </div>
            <div role="tablist" aria-label={`Разделы объекта ${home.name}`} className="flex flex-wrap gap-1 border-b border-border pb-2">
              {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={displayedTab === tab.id} onClick={() => setActiveTab(tab.id)} className={cx("rounded-lg px-3 py-2 text-label transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", displayedTab === tab.id ? "bg-accent/15 font-medium text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>{tab.label}</button>)}
            </div>
            {overviewError ? <EmptyState icon={HomeIcon} title="Не удалось загрузить объект" description="Попробуйте обновить данные." action={<Button size="sm" onClick={() => void refetchOverview()}>Повторить</Button>} /> : overviewLoading || !overview ? <Skeleton className="h-64 w-full" /> : (
              <div role="tabpanel" aria-label={tabs.find((tab) => tab.id === displayedTab)?.label} className="space-y-4">
                {displayedTab === "overview" ? <>
                  {home.note ? <p className="whitespace-pre-wrap text-label text-muted-foreground">{home.note}</p> : null}
                  <ExtensionSlot name="home.object.overview.cards" props={{ workspaceId, home, overview, financeAvailable: isEnabled("finance"), onOpenTab: setActiveTab }} />
                  <div className="grid gap-3 [@container(min-width:680px)]:grid-cols-3">
                    <OverviewShortcut label="Дела" value={overview.taskIds.length} onClick={() => setActiveTab("tasks")} />
                    <OverviewShortcut label="Счётчики" value={overview.meters.length} onClick={() => setActiveTab("meters")} />
                    <OverviewShortcut label="Связанное" value={overview.listIds.length + overview.inventoryIds.length + overview.contacts.length + overview.obligationIds.length} onClick={() => setActiveTab("related")} />
                  </div>
                  <HomeActivity workspaceId={workspaceId} home={home} overview={overview} />
                </> : null}
                {displayedTab === "meters" ? <HomeMeters workspaceId={workspaceId} home={home} overview={overview} /> : null}
                {displayedTab === "tasks" && isEnabled("tasks") ? <HomeTasks workspaceId={workspaceId} home={home} overview={overview} /> : null}
                {displayedTab === "related" ? <div className="grid gap-4 [@container(min-width:900px)]:grid-cols-2">
                  {isEnabled("lists") ? <HomeShopping workspaceId={workspaceId} home={home} overview={overview} /> : null}
                  {isEnabled("inventory") ? <HomeThings workspaceId={workspaceId} home={home} overview={overview} /> : null}
                  {isEnabled("finance") ? <HomePayments workspaceId={workspaceId} home={home} overview={overview} /> : null}
                  <HomeContacts workspaceId={workspaceId} home={home} overview={overview} />
                </div> : null}
                {pluginTabs.map(({ pluginId, component: Component, meta }) => displayedTab === meta?.tabId ? <Component key={pluginId} workspaceId={workspaceId} home={home} overview={overview} financeAvailable={isEnabled("finance")} /> : null)}
              </div>
            )}
          </>
        )}
      </PanelBody>

      <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog === "edit" ? "Изменить объект" : "Новый объект"} size="sm">
        {dialog ? <HomeForm key={dialog + (home?.id ?? "")} initial={dialog === "edit" ? home : null} busy={createHome.isPending || updateHome.isPending} onSubmit={submit} onCancel={() => setDialog(null)} /> : null}
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить объект?"
        description={home ? `«${home.name}»: счётчики, показания и история коммунальных начислений удалятся. Контакты, дела, списки, вещи и платежи останутся в своих разделах, только потеряют привязку к объекту.` : undefined}
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

function FamilyShortcut({ icon: Icon, title, description, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; onClick: () => void }): React.ReactElement {
  return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><Icon className="h-5 w-5 text-muted-foreground" /><span className="min-w-0"><span className="block text-label font-medium">{title}</span><span className="block text-2xs text-subtle-foreground">{description}</span></span><ArrowRight className="ml-auto h-4 w-4 text-subtle-foreground" aria-hidden /></button>;
}

function OverviewShortcut({ label, value, onClick }: { label: string; value: number; onClick: () => void }): React.ReactElement {
  return <button type="button" onClick={onClick} className="rounded-xl border border-border bg-card p-4 text-left hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><span className="block text-2xs text-muted-foreground">{label}</span><span className="mt-1 block text-xl font-semibold tabular-nums">{value}</span></button>;
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
