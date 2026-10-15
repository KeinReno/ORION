"use client";

import type { Goal } from "@orion/shared-types";
import { Badge } from "@orion/ui";
import { Sparkles, Trophy } from "lucide-react";
import { shortDate } from "../../lib/format";
import { skyHealth, type Constellation, type SkyHealth } from "../../lib/goal-constellation";
import { SkyCanvas } from "./sky-canvas";

const HEALTH_BADGE: Record<SkyHealth["tone"], { tone: "success" | "warning" | "accent" | "neutral"; label: string }> = {
  done: { tone: "success", label: "достигнуто" },
  attention: { tone: "warning", label: "требует внимания" },
  ok: { tone: "accent", label: "на ходу" },
  idle: { tone: "neutral", label: "нет следующего шага" }
};

function SkyTile({
  constellation,
  goal,
  goals,
  onOpen,
  trophy
}: {
  constellation: Constellation;
  goal: Goal | undefined;
  goals: ReadonlyArray<Goal>;
  onOpen: (rootId: string) => void;
  trophy?: boolean;
}): React.ReactElement {
  const health = skyHealth(constellation);
  const root = constellation.stars.find((s) => s.id === constellation.rootId)!;
  const badge = HEALTH_BADGE[health.tone];
  return (
    <button
      type="button"
      onClick={() => onOpen(constellation.rootId)}
      aria-label={`Открыть созвездие «${root.label}»`}
      className="space-y-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {constellation.stars.length === 1 ? (
        <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-xl border border-accent/20 bg-[radial-gradient(ellipse_at_50%_20%,#262032_0%,#11121b_55%,#090a10_100%)]">
          <div className="absolute h-16 w-16 rounded-full bg-accent/10 blur-2xl" aria-hidden />
          <Sparkles className="relative h-7 w-7 text-accent" aria-hidden />
          <span className="absolute bottom-3 text-2xs text-subtle-foreground">Откройте и задайте первый шаг</span>
        </div>
      ) : <SkyCanvas constellation={constellation} goals={goals} lens="progress" selectedId={null} mode="mini" />}
      <div className="flex items-center gap-2 px-1">
        {trophy ? <Trophy className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{root.label}</span>
        <span className="font-mono text-label tabular-nums text-muted-foreground">{root.progress === null ? "—" : `${root.progress}%`}</span>
      </div>
      {trophy ? (
        <p className="px-1 text-2xs text-subtle-foreground">Достигнута · последнее изменение {goal ? shortDate(goal.updatedAt) : ""}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {health.overdue > 0 ? <Badge tone="danger">просрочено: {health.overdue}</Badge> : null}
            {health.blocked > 0 ? <Badge tone="warning">ждёт: {health.blocked}</Badge> : null}
            {health.stalled > 0 ? <Badge tone="warning">стоит: {health.stalled}</Badge> : null}
            {health.pace.state === "behind" ? <Badge tone="warning">отстаёт от срока</Badge> : null}
            {health.pace.state === "late" ? <Badge tone="danger">срок прошёл</Badge> : null}
            {health.shared > 0 ? <Badge>общих проектов: {health.shared}</Badge> : null}
            {root.dueAt ? <span className="text-2xs text-subtle-foreground">до {shortDate(root.dueAt)}</span> : null}
          </div>
          {health.next?.nextTask ? (
            <p className="truncate px-1 text-2xs text-subtle-foreground">
              Дальше: {health.next.nextTask.title} <span className="opacity-70">· {health.next.label}</span>
            </p>
          ) : null}
        </>
      )}
    </button>
  );
}

const GRID = "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]";

/**
 * Level 1 of the sky. Active goals first; achieved goals move to the «Небосвод достижений» below
 * (a gallery of finished constellations — also a record of what has been done); dropped ones are
 * folded away. Statuses come from the goals, not from the drawing.
 */
export function SkyOverview({
  constellations,
  goals,
  onOpen
}: {
  constellations: ReadonlyArray<Constellation>;
  goals: ReadonlyArray<Goal>;
  onOpen: (rootId: string) => void;
}): React.ReactElement {
  const goalOf = (c: Constellation): Goal | undefined => goals.find((g) => g.id === c.rootId);
  const active = constellations.filter((c) => goalOf(c)?.status !== "achieved" && goalOf(c)?.status !== "dropped");
  const achieved = constellations.filter((c) => goalOf(c)?.status === "achieved");
  const dropped = constellations.filter((c) => goalOf(c)?.status === "dropped");
  const healths = active.map(skyHealth);
  const attention = healths.filter((h) => h.tone === "attention").length;
  const moving = healths.filter((h) => h.tone === "ok").length;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-label text-muted-foreground">
          {active.length} {active.length === 1 ? "созвездие" : "созвездий"} в работе · на ходу: {moving} · требуют внимания: {attention}. Нажмите на созвездие, чтобы войти в него.
        </p>
        {active.length === 0 ? <p className="text-label text-subtle-foreground">Активных целей нет.</p> : null}
        <div className={GRID}>
          {active.map((c) => (
            <SkyTile key={c.rootId} constellation={c} goal={goalOf(c)} goals={goals} onOpen={onOpen} />
          ))}
        </div>
      </div>

      {achieved.length > 0 ? (
        <section className="space-y-3" aria-label="Небосвод достижений">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Trophy className="h-4 w-4 text-accent" aria-hidden />
            Небосвод достижений · {achieved.length}
          </h2>
          <div className={GRID}>
            {achieved.map((c) => (
              <SkyTile key={c.rootId} constellation={c} goal={goalOf(c)} goals={goals} onOpen={onOpen} trophy />
            ))}
          </div>
        </section>
      ) : null}

      {dropped.length > 0 ? (
        <details className="space-y-3">
          <summary className="cursor-pointer text-label text-subtle-foreground hover:text-foreground">Отменённые цели · {dropped.length}</summary>
          <div className={`${GRID} mt-3`}>
            {dropped.map((c) => (
              <SkyTile key={c.rootId} constellation={c} goal={goalOf(c)} goals={goals} onOpen={onOpen} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
