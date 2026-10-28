"use client";

import {
  useArchiveInventoryItem,
  useCreateInventoryItem,
  useInventoryItems,
  useInventoryMovements,
  useProjects,
  useRecordInventoryMovement,
  useUpdateInventoryItem
} from "@orion/core-react";
import type { InventoryItem, InventoryMovementType } from "@orion/shared-types";
import {
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  Sheet,
  Skeleton,
  StatCard,
  SegmentedControl,
  useContextMenuApi,
  useToast,
  type MenuItem
} from "@orion/ui";
import { Archive, ArchiveRestore, Boxes, LayoutGrid, List, MoreHorizontal, Pencil, Plus, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";
import { describeAuthError } from "../lib/error-message";
import { shortDateTime } from "../lib/format";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { InventoryItemForm, type InventoryItemFormValues } from "./inventory/item-form";
import { InventoryMovementForm, type InventoryMovementFormValues } from "./inventory/movement-form";

const MOVEMENT_TYPE_LABEL: Record<InventoryMovementType, string> = {
  receipt: "Приход",
  issue: "Расход",
  adjustment: "Корректировка"
};

/**
 * Склад (v0.26): item list + a per-item ledger. Balance and average cost are
 * computed server-side from the movement ledger (see InventoryService) —
 * this panel only ever shows them, never re-derives them.
 */
export function InventoryPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { isEnabled } = useEnabledModules();
  const showContextMenu = useContextMenuApi();

  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "low">("all");
  const [layout, setLayout] = useState<"list" | "cards">("list");
  const itemsQuery = useInventoryItems(workspaceId, showArchived);
  const { data: projectList } = useProjects(isEnabled("projects") ? workspaceId : undefined);

  const createItem = useCreateInventoryItem(workspaceId);
  const updateItem = useUpdateInventoryItem(workspaceId);
  const archiveItem = useArchiveInventoryItem(workspaceId);
  const recordMovement = useRecordInventoryMovement(workspaceId);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [pendingArchive, setPendingArchive] = useState<InventoryItem | null>(null);
  const [detail, setDetail] = useState<InventoryItem | null>(null);
  const [recording, setRecording] = useState(false);

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const activeItems = items.filter((item) => !item.archivedAt);
  const lowStockCount = activeItems.filter((item) => item.lowStock).length;
  // The threshold and its marks are the inventory-alerts plugin's.
  const alerts = useSlotContributions("inventory.alerts")[0]?.meta?.api;
  const costing = useSlotContributions("inventory.costing")[0]?.meta?.api;
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return items.filter((item) => {
      if (stockFilter === "low" && (item.archivedAt || !item.lowStock)) return false;
      return !needle || [item.name, item.sku ?? "", item.unit].some((value) => value.toLocaleLowerCase("ru").includes(needle));
    });
  }, [items, query, stockFilter]);

  async function create(values: InventoryItemFormValues): Promise<void> {
    try {
      await createItem.mutateAsync(values);
      setCreating(false);
      toast({ title: "Позиция создана", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать позицию", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function save(itemId: string, values: InventoryItemFormValues): Promise<void> {
    try {
      await updateItem.mutateAsync({ itemId, input: values });
      setEditing(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить позицию", description: describeAuthError(error), tone: "danger" });
    }
  }

  function toggleArchived(item: InventoryItem): void {
    updateItem.mutate(
      { itemId: item.id, input: { archivedAt: item.archivedAt ? null : new Date().toISOString() } },
      {
        onSuccess: (updated) => {
          toast({ title: item.archivedAt ? "Позиция восстановлена" : "Позиция в архиве", tone: "default" });
          if (detail?.id === updated.id) setDetail(updated);
        }
      }
    );
  }

  function confirmArchive(): void {
    const item = pendingArchive;
    if (!item) return;
    setPendingArchive(null);
    archiveItem.mutate(item.id, {
      onSuccess: () => toast({ title: "Позиция в архиве", description: "Леджер движений сохранён", tone: "default" }),
      onError: () => toast({ title: "Не удалось убрать в архив", tone: "danger" })
    });
  }

  async function submitMovement(values: InventoryMovementFormValues): Promise<void> {
    if (!detail) return;
    try {
      await recordMovement.mutateAsync({ itemId: detail.id, input: values });
      setRecording(false);
      toast({ title: "Движение записано", tone: "success" });
      // The item cache refetches; the sheet stays open on the same item.
      const fresh = (itemsQuery.data ?? []).find((item) => item.id === detail.id);
      if (fresh) setDetail(fresh);
    } catch (error) {
      toast({ title: "Не удалось записать движение", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={Boxes}
        title="Склад"
        subtitle="Позиции и остатки — считаются по движениям"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={workspaceId === undefined}>
            <Plus className="h-4 w-4" /> Новая позиция
          </Button>
        }
      >
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input aria-label="Поиск по складу" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или артикул" className="pl-8" />
        </div>
        {alerts ? (
          <SegmentedControl<"all" | "low">
            aria-label="Фильтр склада"
            size="sm"
            value={stockFilter}
            onChange={setStockFilter}
            options={[{ value: "all", label: "Все" }, { value: "low", label: `Мало (${lowStockCount})` }]}
          />
        ) : null}
        <SegmentedControl<"list" | "cards">
          aria-label="Вид склада"
          size="sm"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "list", label: <List className="h-3.5 w-3.5" />, ariaLabel: "Списком" },
            { value: "cards", label: <LayoutGrid className="h-3.5 w-3.5" />, ariaLabel: "Карточками" }
          ]}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            disabled={workspaceId === undefined}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Показать архив
        </label>
      </PanelHeader>

      <PanelBody measure="wide" className="[container-type:inline-size]">
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState icon={Boxes} title="Нет рабочего пространства" description="Склад живёт внутри пространства — создайте его или войдите заново." />
          )
        ) : itemsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : itemsQuery.isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить склад"
            description={describeAuthError(itemsQuery.error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void itemsQuery.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Позиций пока нет"
            description="Заведите первую позицию — остаток появится после первого прихода."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новая позиция
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid max-w-lg grid-cols-2 gap-2">
              <StatCard label="Активных позиций" value={String(activeItems.length)} hint="в работе" />
              {alerts ? <alerts.SummaryStat count={lowStockCount} /> : null}
            </div>

            {visibleItems.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Ничего не найдено"
                description="Попробуйте другое название или артикул либо сбросьте фильтр."
                action={<Button size="sm" variant="outline" onClick={() => { setQuery(""); setStockFilter("all"); }}>Сбросить фильтры</Button>}
              />
            ) : (
            <div className={layout === "cards"
              ? "grid gap-3 [@container(min-width:384px)]:grid-cols-2 [@container(min-width:760px)]:grid-cols-3 [@container(min-width:1040px)]:grid-cols-4"
              : "overflow-hidden rounded-xl border border-border"}>
              {layout === "list" ? (
                <div className="hidden grid-cols-[minmax(0,1fr)_7rem_2rem] gap-3 border-b border-border px-3 py-2 text-2xs uppercase tracking-wide text-subtle-foreground [@container(min-width:560px)]:grid">
                  <span>Позиция</span><span className="text-right">Остаток</span><span />
                </div>
              ) : null}
              {visibleItems.map((item) => {
                const itemMenuItems: (MenuItem | "separator")[] = [
                  { label: "Изменить", icon: Pencil, onSelect: () => setEditing(item) },
                  item.archivedAt
                    ? { label: "Восстановить", icon: ArchiveRestore, onSelect: () => toggleArchived(item) }
                    : { label: "В архив", icon: Archive, onSelect: () => setPendingArchive(item) }
                ];
                return (
                <Card
                  key={item.id}
                  interactive
                  className={layout === "cards"
                    ? `flex flex-col gap-2 ${item.archivedAt ? "opacity-60" : ""}`
                    : `grid min-w-0 grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-3 rounded-none border-0 border-b border-border px-3 py-2 last:border-b-0 [@container(min-width:560px)]:grid-cols-[minmax(0,1fr)_7rem_2rem] ${item.archivedAt ? "opacity-60" : ""}`}
                  onClick={() => setDetail(item)}
                  onContextMenu={(e) => showContextMenu(e, itemMenuItems)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Открыть позицию ${item.name}`}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      setDetail(item);
                    }
                  }}
                >
                  <div className={layout === "cards" ? "flex items-start justify-between gap-2" : "contents"}>
                    <div className={layout === "list" ? "col-start-1 row-start-1 min-w-0" : "min-w-0"}>
                      <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                      <p className="text-2xs text-subtle-foreground">
                        {item.sku ? `${item.sku} · ` : ""}
                        {item.unit}
                        {item.archivedAt ? " · в архиве" : ""}
                      </p>
                    </div>
                    <div className={layout === "list" ? "col-start-3 row-start-1" : undefined}>
                    <DropdownMenu
                      trigger={({ toggle }) => (
                        <IconButton
                          label="Действия"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle();
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </IconButton>
                      )}
                      items={itemMenuItems}
                    />
                    </div>
                  </div>
                  <div className={layout === "cards" ? "flex items-center gap-2" : "col-start-2 row-start-1 flex items-center justify-end gap-2"}>
                    <p className={`font-mono font-semibold tabular-nums ${layout === "cards" ? "text-xl" : "text-sm"} ${alerts && item.lowStock ? "text-destructive" : "text-foreground"}`}>
                      {item.balance} {item.unit}
                    </p>
                    {alerts && item.lowStock ? <span className={layout === "list" ? "hidden [@container(min-width:560px)]:inline-flex" : undefined}><alerts.ItemBadge /></span> : null}
                  </div>
                  {layout === "cards" && costing ? <costing.CardLine avgCostMinor={item.avgCostMinor} /> : null}
                </Card>
                );
              })}
            </div>
            )}
          </div>
        )}
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новая позиция" size="sm">
        <InventoryItemForm
          projects={isEnabled("projects") ? projectList : undefined}
          busy={createItem.isPending}
          submitLabel="Создать"
          onCancel={() => setCreating(false)}
          onSubmit={create}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Изменить позицию" size="sm">
        {editing ? (
          <InventoryItemForm
            key={editing.id}
            initial={editing}
            projects={isEnabled("projects") ? projectList : undefined}
            busy={updateItem.isPending}
            submitLabel="Сохранить"
            onCancel={() => setEditing(null)}
            onSubmit={(values) => save(editing.id, values)}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingArchive !== null}
        title="Убрать в архив?"
        description={
          pendingArchive ? `«${pendingArchive.name}» уйдёт из списка. Леджер движений сохранится — позицию можно вернуть из архива.` : undefined
        }
        confirmLabel="В архив"
        danger={false}
        onConfirm={confirmArchive}
        onCancel={() => setPendingArchive(null)}
      />

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail?.name} width="32rem">
        {detail ? (
          <InventoryItemDetail
            item={detail}
            recording={recording}
            recordBusy={recordMovement.isPending}
            onStartRecord={() => setRecording(true)}
            onCancelRecord={() => setRecording(false)}
            onSubmitMovement={submitMovement}
          />
        ) : null}
      </Sheet>
    </PanelShell>
  );
}

function InventoryItemDetail({
  item,
  recording,
  recordBusy,
  onStartRecord,
  onCancelRecord,
  onSubmitMovement
}: {
  item: InventoryItem;
  recording: boolean;
  recordBusy: boolean;
  onStartRecord: () => void;
  onCancelRecord: () => void;
  onSubmitMovement: (values: InventoryMovementFormValues) => void | Promise<void>;
}): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const movementsQuery = useInventoryMovements(workspace?.id, item.id);
  const alerts = useSlotContributions("inventory.alerts")[0]?.meta?.api;
  const costing = useSlotContributions("inventory.costing")[0]?.meta?.api;
  const movements = movementsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Остаток"
          value={<span className={alerts && item.lowStock ? "text-destructive" : undefined}>{`${item.balance} ${item.unit}`}</span>}
          hint={alerts ? alerts.balanceHint(item.lowStock) : undefined}
        />
        {costing ? <costing.DetailStat avgCostMinor={item.avgCostMinor} /> : null}
      </div>

      {recording ? (
        <InventoryMovementForm unit={item.unit} busy={recordBusy} onCancel={onCancelRecord} onSubmit={onSubmitMovement} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onStartRecord}>
            <Plus className="h-4 w-4" /> Новое движение
          </Button>
          {workspace ? <ExtensionSlot name="inventory.item.actions" props={{ workspaceId: workspace.id, item }} /> : null}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-subtle-foreground">Леджер</span>
        {movementsQuery.isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : movements.length === 0 ? (
          <p className="text-xs text-muted-foreground">Движений пока нет.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {movements.map((movement) => (
              <li key={movement.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="text-foreground">
                    {MOVEMENT_TYPE_LABEL[movement.type]}
                    {movement.note ? ` · ${movement.note}` : ""}
                  </p>
                  <p className="text-2xs text-subtle-foreground">{shortDateTime(movement.createdAt)}</p>
                </div>
                <span className={`shrink-0 font-medium ${movement.quantity < 0 ? "text-destructive" : "text-success"}`}>
                  {movement.quantity > 0 ? "+" : ""}
                  {movement.quantity} {item.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
