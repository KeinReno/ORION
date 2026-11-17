"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  DEFAULT_GOAL_CANVAS_VIEWPORT,
  goalCanvasAutoResultSchema,
  goalCanvasKey,
  goalCanvasLayoutResponseSchema,
  goalGraphSchema,
  type GoalCanvasEntry,
  type GoalCanvasViewport,
  type GoalGraphNode
} from "@orion/shared-types";
import { Button, Skeleton, useToast } from "@orion/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "../../lib/error-message";
import { openEntity, openProject } from "../../lib/panel-bus";

/**
 * P3-3: серверная доска цели. Карточки — узлы `GET goals/:id/graph` (цели, проекты,
 * задачи, вехи материалы), позиции — `GoalCanvasLayout` (задание 08): частичный PUT
 * сливает ноды по `updatedAt`, конфликт хранится на сервере с обеими версиями и
 * побеждает более свежая запись. «Автораскладка» — POST canvas-layout/auto
 * (ручные якоря `dirty` неподвижны), применяется явным PUT.
 */

const CARD_W = 208;
const CARD_H = 88;
const GRID_X = 264;
const GRID_Y = 148;

const KIND_TONE: Record<GoalGraphNode["entityType"], string> = {
  goal: "text-amber-300 border-amber-500/50",
  project: "text-sky-300 border-sky-500/50",
  task: "text-emerald-300 border-emerald-500/50",
  milestone: "text-violet-300 border-violet-500/50",
  material: "text-muted-foreground border-border"
};

function fallbackPosition(index: number): { x: number; y: number } {
  return { x: (index % 4) * GRID_X + 24, y: Math.floor(index / 4) * GRID_Y + 24 };
}

export function GoalBoard({ workspaceId, goalId }: { workspaceId: string; goalId: string }): React.ReactElement {
  const { api } = useCore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const client = () => createModuleClient(api, workspaceModuleBase(workspaceId, "projects"));
  const graphQuery = useQuery({
    queryKey: ["goal-board", workspaceId, goalId, "graph"],
    queryFn: () => client().get(`/goals/${goalId}/graph`, goalGraphSchema)
  });
  const layoutQuery = useQuery({
    queryKey: ["goal-board", workspaceId, goalId, "layout"],
    queryFn: () => client().get(`/goals/${goalId}/canvas-layout`, goalCanvasLayoutResponseSchema)
  });

  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [viewport, setViewport] = useState<GoalCanvasViewport>(DEFAULT_GOAL_CANVAS_VIEWPORT);
  const adoptedRevision = useRef<number | null>(null);
  // Viewport сервера принимаем один раз за ревизию (после наших PUT'ов не дёргаемся).
  const layoutRevision = layoutQuery.data?.layout.revision;
  useEffect(() => {
    if (layoutRevision === undefined || adoptedRevision.current === layoutRevision) return;
    adoptedRevision.current = layoutRevision;
    setViewport(layoutQuery.data?.layout.viewport ?? DEFAULT_GOAL_CANVAS_VIEWPORT);
  }, [layoutRevision, layoutQuery.data]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["goal-board", workspaceId, goalId] });
  }, [queryClient, workspaceId, goalId]);

  const putLayout = useMutation({
    mutationFn: (body: { entries?: GoalCanvasEntry[]; viewport?: GoalCanvasViewport }) =>
      client().put(`/goals/${goalId}/canvas-layout`, { ...body, replace: false }, goalCanvasLayoutResponseSchema),
    onSuccess: (response) => {
      adoptedRevision.current = response.layout.revision;
      setOverrides({});
      if (response.conflicts.length > 0) {
        toast({
          title: "Конфликт раскладки",
          description: "Позиции менялись на другом устройстве; показана самая свежая версия. Обе версии сохранены на сервере.",
          tone: "default"
        });
      }
    },
    onError: (error) => toast({ title: "Не удалось сохранить раскладку", description: describeError(error), tone: "danger" })
  });

  const autoLayout = useMutation({
    mutationFn: async () => {
      const result = await client().post(`/goals/${goalId}/canvas-layout/auto`, { respectManual: true, strategy: "deterministic" }, goalCanvasAutoResultSchema);
      return client().put(
        `/goals/${goalId}/canvas-layout`,
        { entries: result.entries.map(({ broken: _broken, ...entry }) => ({ ...entry, updatedAt: new Date().toISOString() })), replace: false },
        goalCanvasLayoutResponseSchema
      );
    },
    onSuccess: () => { toast({ title: "Автораскладка применена", description: "Ручные якоря остались на местах." }); void refresh(); },
    onError: (error) => toast({ title: "Не удалось применить автораскладку", description: describeError(error), tone: "danger" })
  });

  const nodes = useMemo(() => graphQuery.data?.nodes ?? [], [graphQuery.data]);
  const entries = useMemo(() => layoutQuery.data?.layout.entries ?? [], [layoutQuery.data]);

  const positionOf = useCallback((node: GoalGraphNode, index: number): { x: number; y: number } => {
    const key = goalCanvasKey(node.entityType, node.entityId);
    const override = overrides[key];
    if (override) return override;
    if (node.x !== null && node.y !== null) return { x: node.x, y: node.y };
    return fallbackPosition(index);
  }, [overrides]);

  const positions = useMemo(
    () => new Map(nodes.map((node, index) => [goalCanvasKey(node.entityType, node.entityId), positionOf(node, index)] as const)),
    [nodes, positionOf]
  );

  /** Черновик перетаскивания: либо карточка, либо панорама поля. */
  const dragRef = useRef<{ pointerId: number; mode: "card" | "pan"; key?: string; dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  // viewport из state для onPointerUp: ref, чтобы не пересоздавать обработчики.
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  function onCardPointerDown(event: React.PointerEvent, node: GoalGraphNode): void {
    if (event.button !== 0) return;
    const key = goalCanvasKey(node.entityType, node.entityId);
    const point = positions.get(key) ?? fallbackPosition(0);
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, mode: "card", key, dx: event.clientX - point.x, dy: event.clientY - point.y, startX: event.clientX, startY: event.clientY, moved: false };
  }

  function onFieldPointerDown(event: React.PointerEvent): void {
    if (event.button !== 0 || (event.target as Element).closest("[data-board-card]")) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, mode: "pan", dx: event.clientX - viewport.x, dy: event.clientY - viewport.y, startX: event.clientX, startY: event.clientY, moved: false };
  }

  function onPointerMove(event: React.PointerEvent): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    if (drag.mode === "card" && drag.key) {
      const x = event.clientX - drag.dx;
      const y = event.clientY - drag.dy;
      setOverrides((prev) => ({ ...prev, [drag.key as string]: { x, y } }));
    } else {
      setViewport((prev) => ({ ...prev, x: event.clientX - drag.dx, y: event.clientY - drag.dy }));
    }
  }

  function onPointerUp(_event: React.PointerEvent): void {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return;
    if (drag.mode === "card" && drag.key) {
      const [entityType, entityId] = drag.key.split(/:(.*)/s) as [GoalGraphNode["entityType"], string];
      const at = overrides[drag.key];
      if (!at) return;
      const stored = entries.find((entry) => goalCanvasKey(entry.entityType, entry.entityId) === drag.key);
      putLayout.mutate({
        entries: [{ entityType, entityId, x: at.x, y: at.y, width: stored?.width, collapsed: stored?.collapsed, dirty: true, updatedAt: new Date().toISOString() }]
      });
    } else {
      putLayout.mutate({ viewport: viewportRef.current });
    }
  }

  function zoom(delta: number): void {
    setViewport((prev) => ({ ...prev, zoom: Math.min(2, Math.max(0.25, Number((prev.zoom + delta).toFixed(2)))) }));
  }

  function openNode(node: GoalGraphNode): void {
    if (node.entityType === "goal") openEntity("goal", node.entityId, node.title);
    else if (node.entityType === "task") openEntity("task", node.entityId, node.title);
    else if (node.entityType === "project") openProject(node.entityId, node.title);
  }

  const edges = graphQuery.data?.edges ?? [];
  const conflicts = layoutQuery.data?.conflicts ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={autoLayout.isPending || putLayout.isPending} onClick={() => autoLayout.mutate()}>
          <Wand2 className="mr-1 h-3.5 w-3.5" />
          Автораскладка
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => zoom(-0.1)} aria-label="Уменьшить масштаб">−</Button>
        <span className="font-mono text-label tabular-nums text-muted-foreground">{Math.round(viewport.zoom * 100)}%</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => zoom(0.1)} aria-label="Увеличить масштаб">+</Button>
        {conflicts.length > 0 ? <span className="text-label text-amber-300">Конфликтов раскладки: {conflicts.length}</span> : null}
        <span className="text-2xs text-subtle-foreground">Раскладка общая для пространства: свежая правка побеждает, конфликт хранится с обеими версиями.</span>
      </div>
      {graphQuery.isLoading || layoutQuery.isLoading ? <Skeleton className="h-[60vh] w-full" /> : graphQuery.isError ? (
        <p role="alert" className="text-xs text-destructive">Не удалось загрузить граф цели.</p>
      ) : (
        <div
          className="relative h-[60vh] touch-none select-none overflow-hidden rounded-lg border border-border bg-background"
          onPointerDown={onFieldPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="application"
          aria-label="Доска цели"
        >
          <div className="absolute inset-0" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, transformOrigin: "0 0" }}>
            <svg className="absolute left-0 top-0 h-full w-full" aria-hidden>
              {edges.map((edge) => {
                const from = positions.get(goalCanvasKey(edge.source.entityType, edge.source.entityId));
                const to = positions.get(goalCanvasKey(edge.target.entityType, edge.target.entityId));
                if (!from || !to) return null;
                return (
                  <line
                    key={edge.linkId}
                    x1={from.x + CARD_W / 2}
                    y1={from.y + CARD_H / 2}
                    x2={to.x + CARD_W / 2}
                    y2={to.y + CARD_H / 2}
                    stroke="currentColor"
                    strokeOpacity={edge.kind === "depends_on" ? 0.55 : edge.kind === "continues" ? 0.35 : 0.2}
                    strokeDasharray={edge.kind === "depends_on" ? undefined : edge.kind === "continues" ? "6 4" : "2 4"}
                    strokeWidth={edge.kind === "depends_on" ? 2 : 1}
                  />
                );
              })}
            </svg>
            {nodes.map((node, index) => {
              const key = goalCanvasKey(node.entityType, node.entityId);
              const at = positionOf(node, index);
              const tone = KIND_TONE[node.entityType];
              return (
                <article
                  key={key}
                  data-board-card
                  className={`absolute cursor-grab rounded-lg border bg-card p-3 text-xs active:cursor-grabbing ${tone.split(" ")[1] ?? "border-border"}`}
                  style={{ left: at.x, top: at.y, width: CARD_W, minHeight: CARD_H }}
                  onPointerDown={(event) => onCardPointerDown(event, node)}
                  onDoubleClick={() => openNode(node)}
                >
                  <header className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-xs font-medium" title={node.title}>{node.title}</h3>
                    {node.broken ? <span className="shrink-0 text-amber-400" title="Запись, на которую ссылалась позиция, недоступна">битая</span> : null}
                  </header>
                  {node.subtitle ? <p className="mt-1 truncate text-2xs text-muted-foreground">{node.subtitle}</p> : null}
                  {node.progress !== null ? (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-label={`Прогресс ${node.progress}%`}>
                      <div className="h-full bg-current opacity-70" style={{ width: `${node.progress}%` }} />
                    </div>
                  ) : null}
                  <p className="mt-1 text-2xs text-subtle-foreground">
                    {node.entityType === "goal" ? "Цель" : node.entityType === "project" ? "Проект" : node.entityType === "task" ? "Задача" : node.entityType === "milestone" ? "Веха" : "Материал"}
                    {node.status ? ` · ${node.status}` : ""} · двойной ЛКМ открывает запись
                  </p>
                </article>
              );
            })}
          </div>
          {nodes.length === 0 ? <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Граф цели пуст: добавьте подцели, планы-проекты или задачи.</p> : null}
        </div>
      )}
    </div>
  );
}
