"use client";

import type { EntityLink, Goal } from "@orion/shared-types";
import { Minus, Plus, Scan } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  CONSTELLATION_H,
  CONSTELLATION_W,
  backgroundStars,
  lensVisible,
  neighbour,
  pathToRoot,
  starAt,
  validParents,
  type Constellation,
  type Lens,
  type Star,
  type StarState
} from "../../lib/goal-constellation";
import { applyPins, clampToSky } from "../../lib/goal-sky-layout";
import { openEntity } from "../../lib/panel-bus";

export const STATE_LABEL: Record<StarState, string> = {
  done: "достигнуто",
  lit: "в пути",
  dim: "ещё не начато",
  unknown: "нет задач — прогресс неизвестен",
  dropped: "отменено"
};

/** Unknown is a hollow dashed ring: "we do not know" must not look like zero or like done. */
function starClasses(state: StarState): string {
  switch (state) {
    case "done":
      return "fill-accent stroke-accent";
    case "lit":
      return "fill-accent/60 stroke-accent";
    case "dim":
      return "fill-muted stroke-border";
    case "unknown":
      return "fill-transparent stroke-subtle-foreground";
    case "dropped":
      return "fill-muted/50 stroke-border";
  }
}

export const KIND_LABEL = { goal: "Цель", plan: "План", milestone: "Веха" } as const;

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;
const DRAG_THRESHOLD_PX = 6;

interface View {
  k: number;
  x: number;
  y: number;
}
const HOME: View = { k: 1, x: 0, y: 0 };

interface Gesture {
  kind: "pan" | "star" | "pin";
  startClientX: number;
  startClientY: number;
  view: View;
  starId?: string;
  moved: boolean;
}

/** Time elapsed towards the deadline as an arc around a goal star; its colour says whether progress keeps up. */
function PaceRing({ star }: { star: Star }): React.ReactElement {
  const radius = star.r + 5;
  const circumference = 2 * Math.PI * radius;
  const elapsed = star.pace.elapsed ?? 0;
  const tone = star.pace.state === "late" ? "stroke-destructive" : star.pace.state === "behind" ? "stroke-warning" : star.pace.state === "unknown" ? "stroke-subtle-foreground" : "stroke-accent";
  return (
    <g transform={`rotate(-90 ${star.x} ${star.y})`} pointerEvents="none">
      <circle cx={star.x} cy={star.y} r={radius} fill="none" className="stroke-border" strokeWidth={1.25} opacity={0.6} />
      <circle
        cx={star.x}
        cy={star.y}
        r={radius}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={`${(elapsed / 100) * circumference} ${circumference}`}
        className={tone}
      />
    </g>
  );
}

export interface SkyCanvasProps {
  constellation: Constellation;
  goals: ReadonlyArray<Goal>;
  lens: Lens;
  selectedId: string | null;
  selectedLinks?: ReadonlyArray<EntityLink>;
  visibleLinkIds?: ReadonlySet<string>;
  /** mini = a non-interactive thumbnail for the overview. */
  mode: "mini" | "full";
  onSelect?: (id: string) => void;
  /** A goal star was dropped onto another goal star. */
  onReparent?: (goalId: string, parentId: string) => void;
  /** A project from the tray was dropped onto a goal star. */
  onDropProject?: (projectId: string, goalId: string) => void;
  /** Arrange mode (or Shift held): a drag moves the star itself; the new position is reported here. */
  arrange?: boolean;
  onPin?: (starId: string, x: number, y: number) => void;
}

/**
 * The drawing and the gestures of one constellation. Layout is not computed here
 * (`buildConstellations`); this only draws it and turns pointer / keyboard input into
 * select / pan / zoom / drop callbacks. Editing itself is the caller's job.
 */
export function SkyCanvas({ constellation: base, goals, lens, selectedId, selectedLinks = [], visibleLinkIds, mode, onSelect, onReparent, onDropProject, arrange = false, onPin }: SkyCanvasProps): React.ReactElement {
  const full = mode === "full";
  const glowId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [view, setView] = useState<View>(HOME);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverDrop, setHoverDrop] = useState<string | null>(null);
  // While a star is being arranged it follows the pointer and its links follow it.
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null);
  const constellation = useMemo(() => (draft ? applyPins(base, { [draft.id]: { x: draft.x, y: draft.y } }) : base), [base, draft]);

  const dust = useMemo(() => backgroundStars(constellation.rootId), [constellation.rootId]);
  const byId = useMemo(() => new Map(constellation.stars.map((s) => [s.id, s])), [constellation.stars]);
  const visible = useMemo(() => lensVisible(constellation, lens), [constellation, lens]);
  const hot = useMemo(() => new Set(selectedId ? pathToRoot(constellation, selectedId) : []), [constellation, selectedId]);
  const legalParents = useMemo(() => (dragging ? validParents(goals, byId.get(dragging.id)?.goalId ?? null) : null), [dragging, goals, byId]);
  const selectedStar = selectedId ? byId.get(selectedId) : undefined;
  const prerequisites = selectedStar?.kind === "goal" ? selectedLinks.filter((link) => link.kind === "goal_prerequisite") : [];
  const mapRecords = selectedStar?.kind === "goal" ? selectedLinks.filter((link) => link.kind !== "goal_prerequisite" && visibleLinkIds?.has(link.id)).slice(0, 4) : [];

  /** Client pixels -> layout coordinates (undoes the pan / zoom group). */
  function toLayout(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    const world = worldRef.current;
    const ctm = world?.getScreenCTM();
    if (!svg || !ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  // Ordinary wheel movement keeps scrolling the page; Ctrl/Cmd + wheel zooms the sky.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !full) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = ((event.clientX - rect.left) / rect.width) * CONSTELLATION_W;
      const sy = ((event.clientY - rect.top) / rect.height) * CONSTELLATION_H;
      setView((v) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-event.deltaY * 0.0015)));
        const ratio = k / v.k;
        return { k, x: sx - (sx - v.x) * ratio, y: sy - (sy - v.y) * ratio };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [full]);

  function zoomBy(factor: number): void {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      const ratio = k / v.k;
      const cx = CONSTELLATION_W / 2;
      const cy = CONSTELLATION_H / 2;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!full || event.button !== 0) return;
    const starEl = (event.target as Element).closest("[data-star]");
    const starId = starEl?.getAttribute("data-star") ?? undefined;
    const star = starId ? byId.get(starId) : undefined;
    gestureRef.current = {
      // Only non-root goal stars can be moved; everything else (plans, the root, empty sky) pans.
      kind: star && onPin && (arrange || event.shiftKey) ? "pin" : star && star.kind === "goal" && star.depth > 0 && onReparent ? "star" : "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      view,
      starId,
      moved: false
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = event.clientX - gesture.startClientX;
    const dy = event.clientY - gesture.startClientY;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;
    if (gesture.kind === "pin" && gesture.starId) {
      const p = toLayout(event.clientX, event.clientY);
      if (p) setDraft({ id: gesture.starId, ...clampToSky(p.x, p.y) });
      return;
    }
    if (gesture.kind === "star" && gesture.starId) {
      const p = toLayout(event.clientX, event.clientY);
      if (p) {
        setDragging({ id: gesture.starId, ...p });
        setHoverDrop(starAt(constellation.stars, p.x, p.y, 14, (s) => s.kind === "goal" && s.id !== gesture.starId)?.id ?? null);
      }
      return;
    }
    const rect = svgRef.current!.getBoundingClientRect();
    setView({ k: gesture.view.k, x: gesture.view.x + (dx * CONSTELLATION_W) / rect.width, y: gesture.view.y + (dy * CONSTELLATION_H) / rect.height });
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    svgRef.current?.releasePointerCapture(event.pointerId);
    if (gesture.kind === "pin" && gesture.moved && gesture.starId) {
      const placed = draft;
      setDraft(null);
      if (placed) onPin?.(placed.id, placed.x, placed.y);
      return;
    }
    if (gesture.kind === "star" && gesture.moved && gesture.starId) {
      const target = hoverDrop && legalParents?.has(hoverDrop) ? hoverDrop : null;
      setDragging(null);
      setHoverDrop(null);
      if (target) onReparent?.(gesture.starId, target);
      return;
    }
    if (!gesture.moved && gesture.starId) onSelect?.(gesture.starId);
  }

  function focusStar(id: string): void {
    requestAnimationFrame(() => svgRef.current?.querySelector<SVGGElement>(`[data-star="${CSS.escape(id)}"]`)?.focus());
  }

  function onStarKey(event: KeyboardEvent<SVGGElement>, star: Star): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(star.id);
      return;
    }
    const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[event.key as "ArrowUp"];
    if (!direction) return;
    event.preventDefault();
    const next = neighbour(constellation, star.id, direction);
    if (next) {
      onSelect?.(next);
      focusStar(next);
    }
  }

  // A project dragged in from the tray: HTML5 DnD gives pixels, the same hit test resolves the goal under them.
  function projectTarget(clientX: number, clientY: number): Star | null {
    const p = toLayout(clientX, clientY);
    return p ? starAt(constellation.stars, p.x, p.y, 16, (s) => s.kind === "goal") : null;
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border bg-[radial-gradient(ellipse_at_center,#16161f_0%,#07070b_100%)]"
      onDragOver={
        full
          ? (event) => {
              if (!event.dataTransfer.types.includes("application/x-orion-project")) return;
              event.preventDefault();
              setHoverDrop(projectTarget(event.clientX, event.clientY)?.id ?? null);
            }
          : undefined
      }
      onDragLeave={full ? () => setHoverDrop(null) : undefined}
      onDrop={
        full
          ? (event) => {
              const projectId = event.dataTransfer.getData("application/x-orion-project");
              const target = projectId ? projectTarget(event.clientX, event.clientY) : null;
              setHoverDrop(null);
              if (projectId && target) {
                event.preventDefault();
                onDropProject?.(projectId, target.goalId);
              }
            }
          : undefined
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CONSTELLATION_W} ${CONSTELLATION_H}`}
        role="group"
        aria-label={`Созвездие ${byId.get(constellation.rootId)?.label ?? ""}`}
        className={`block h-auto w-full text-accent ${full ? (dragging ? "cursor-grabbing touch-pan-y" : "cursor-grab touch-pan-y") : "pointer-events-none"}`}
        style={{ aspectRatio: `${CONSTELLATION_W} / ${CONSTELLATION_H}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        {dust.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} className="fill-foreground" opacity={d.o} />
        ))}

        {full && constellation.stars.length > 1 ? (
          <g aria-hidden="true" className="fill-subtle-foreground text-[9px] tracking-[0.24em]">
            <text x={22} y={27}>РЕЗУЛЬТАТ</text>
            <text x={22} y={CONSTELLATION_H - 22}>С ЧЕГО НАЧАТЬ · ДВИГАЙТЕСЬ ВВЕРХ</text>
          </g>
        ) : null}

        <g ref={worldRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* Routes first, so the stars sit on top of the lines. */}
          {constellation.links.map((link) => {
            const a = byId.get(link.from)!;
            const b = byId.get(link.to)!;
            const route = hot.has(link.from) && hot.has(link.to);
            const faded = visible !== null && !(visible.has(link.from) && visible.has(link.to));
            return (
              <path
                key={`${link.from}-${link.to}`}
                d={`M ${b.x} ${b.y} C ${b.x} ${(a.y + b.y) / 2}, ${a.x} ${(a.y + b.y) / 2}, ${a.x} ${a.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={0.8 + link.share * 2.4 + (route ? 0.8 : 0)}
                strokeDasharray={link.lit || route ? undefined : "3 4"}
                opacity={faded ? 0.08 : route ? 0.9 : link.lit ? 0.6 : 0.38}
                className={link.lit || route ? undefined : "text-subtle-foreground"}
              />
            );
          })}

          {prerequisites.map((link) => {
            const otherId = link.sourceId === selectedStar?.goalId ? link.targetId : link.sourceId;
            const other = byId.get(otherId);
            if (!other || !selectedStar) return null;
            const from = link.sourceId === selectedStar.goalId ? selectedStar : other;
            const to = link.targetId === selectedStar.goalId ? selectedStar : other;
            return <g key={`dependency-${link.id}`} aria-hidden="true"><path d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2 + 18} ${(from.y + to.y) / 2} ${to.x} ${to.y}`} fill="none" className="stroke-warning" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.85} /><circle cx={from.x} cy={from.y} r={2.4} className="fill-warning" /></g>;
          })}

          {constellation.stars.map((star) => {
            const lit = star.state === "done" || star.state === "lit";
            const isSelected = star.id === selectedId;
            const faded = visible !== null && !visible.has(star.id);
            const legal = dragging !== null && star.kind === "goal" && legalParents?.has(star.id);
            const dropHot = (dragging !== null || hoverDrop !== null) && hoverDrop === star.id && star.kind === "goal";
            const label = full ? (star.label.length > 26 ? `${star.label.slice(0, 25)}…` : star.label) : star.depth === 0 ? star.label : "";
            return (
              <g
                key={star.id}
                data-star={star.id}
                role={full ? "button" : undefined}
                tabIndex={full ? 0 : undefined}
                aria-label={`${KIND_LABEL[star.kind]} ${star.label}: ${STATE_LABEL[star.state]}${star.progress === null ? "" : `, ${star.progress}%`}${star.frontier ? ", следующий шаг готов" : ""}${star.overdue ? `, просрочено задач: ${star.overdue}` : ""}${star.blocked ? `, блокировано: ${star.blocked}` : ""}${star.stalled ? ", стоит" : ""}${star.pace.state === "behind" ? ", отстаёт от срока" : ""}${star.pace.state === "late" ? ", срок прошёл" : ""}${star.sharedWith.length ? ", проект служит и другим целям" : ""}`}
                aria-pressed={full ? isSelected : undefined}
                onKeyDown={full ? (event) => onStarKey(event, star) : undefined}
                className={`outline-none [&:focus-visible>circle.core]:stroke-foreground ${full ? "cursor-pointer" : ""}`}
                opacity={faded ? 0.15 : dragging?.id === star.id ? 0.35 : 1}
              >
                <title>{`${KIND_LABEL[star.kind]}: ${star.label}. ${STATE_LABEL[star.state]}`}</title>
                {lit || isSelected ? <circle cx={star.x} cy={star.y} r={star.r * 2.6} fill="currentColor" opacity={star.state === "done" ? 0.55 : isSelected ? 0.3 : 0.24} filter={`url(#${glowId})`} /> : null}
                {star.frontier && !faded ? (
                  <circle
                    cx={star.x}
                    cy={star.y}
                    r={star.r + 3}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="motion-safe:animate-ping [transform-box:fill-box] [transform-origin:center]"
                  />
                ) : null}
                {star.stalled ? <circle cx={star.x} cy={star.y} r={star.r + 4.5} fill="none" strokeWidth={1.25} strokeDasharray="2 3" className="stroke-warning" /> : null}
                {star.pace.state !== "none" ? <PaceRing star={star} /> : null}
                {isSelected ? <circle cx={star.x} cy={star.y} r={star.r + 8} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.8} /> : null}
                {legal || dropHot ? (
                  <circle cx={star.x} cy={star.y} r={star.r + 10} fill="none" strokeWidth={dropHot ? 2.5 : 1} strokeDasharray={dropHot ? undefined : "4 3"} className={dropHot ? "stroke-foreground" : "stroke-accent"} />
                ) : null}
                {/* Generous invisible hit area: the smallest star is only ~9px wide. */}
                <circle cx={star.x} cy={star.y} r={Math.max(star.r + 6, 14)} fill="transparent" />
                {star.kind === "milestone" ? (
                  <rect
                    x={star.x - star.r}
                    y={star.y - star.r}
                    width={star.r * 2}
                    height={star.r * 2}
                    transform={`rotate(45 ${star.x} ${star.y})`}
                    strokeWidth={1.5}
                    strokeDasharray={star.state === "unknown" ? "2 2" : undefined}
                    className={`core ${starClasses(star.state)}`}
                  />
                ) : (
                  <circle
                    cx={dragging?.id === star.id ? dragging.x : star.x}
                    cy={dragging?.id === star.id ? dragging.y : star.y}
                    r={star.r}
                    strokeWidth={1.5}
                    strokeDasharray={star.state === "unknown" ? "2 2" : undefined}
                    className={`core ${starClasses(star.state)}`}
                  />
                )}
                {star.sharedWith.length > 0 ? <circle cx={star.x + star.r * 0.85} cy={star.y + star.r * 0.85} r={2.6} className="fill-foreground stroke-background" strokeWidth={1} /> : null}
                {star.overdue > 0 ? <circle cx={star.x + star.r * 0.8} cy={star.y - star.r * 0.8} r={3} className="fill-destructive" /> : null}
                {star.blocked > 0 ? <circle cx={star.x - star.r * 0.8} cy={star.y - star.r * 0.8} r={3} className="fill-warning" /> : null}
                {label ? (
                  <text x={star.x} y={star.y + star.r + 16} textAnchor="middle" className={`pointer-events-none text-[12px] ${hot.has(star.id) || star.depth === 0 ? "fill-foreground" : "fill-subtle-foreground"}`}>
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {selectedStar && mapRecords.map((link, index) => {
            const other = link.sourceType === "goal" && link.sourceId === selectedStar.goalId
              ? { type: link.targetType, id: link.targetId }
              : { type: link.sourceType, id: link.sourceId };
            const left = selectedStar.x > CONSTELLATION_W / 2;
            const x = left ? selectedStar.x - 164 : selectedStar.x + 24;
            const y = Math.min(CONSTELLATION_H - 18, Math.max(34, selectedStar.y - 10 + index * 28));
            const title = link.title.length > 19 ? `${link.title.slice(0, 18)}…` : link.title;
            const open = (): void => openEntity(other.type, other.id, link.title);
            return <g key={`record-${link.id}`} role="button" tabIndex={0} aria-label={`Открыть ${link.title}`} onClick={(event) => { event.stopPropagation(); open(); }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }} className="cursor-pointer outline-none focus-visible:opacity-70">
              <title>{link.title}</title>
              <path d={`M ${selectedStar.x} ${selectedStar.y} L ${left ? x + 136 : x} ${y - 5}`} fill="none" className="stroke-accent" strokeWidth={0.8} opacity={0.5} />
              <rect x={x} y={y - 16} width={136} height={22} rx={6} className="fill-card stroke-accent/60" strokeWidth={0.8} />
              <text x={x + 8} y={y - 1} className="fill-foreground text-[10px]">{title}</text>
            </g>;
          })}
        </g>
      </svg>

      {full ? (
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          {(
            [
              { label: "Приблизить", icon: Plus, run: () => zoomBy(1.4) },
              { label: "Отдалить", icon: Minus, run: () => zoomBy(1 / 1.4) },
              { label: "Вернуть вид", icon: Scan, run: () => setView(HOME) }
            ] as const
          ).map(({ label, icon: Icon, run }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={run}
              className="rounded-md border border-border bg-card/80 p-1.5 text-subtle-foreground backdrop-blur hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
