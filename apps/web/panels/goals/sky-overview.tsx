"use client";

import type { Goal } from "@orion/shared-types";
import { Badge } from "@orion/ui";
import { ArrowUpRight, FolderKanban, Sparkles, Trophy } from "lucide-react";
import { shortDate } from "../../lib/format";
import { skyHealth, type Constellation, type SkyHealth } from "../../lib/goal-constellation";
import { openProject } from "../../lib/panel-bus";
import { SkyCanvas } from "./sky-canvas";
import styles from "./sky-canvas.module.css";

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
  const plans = constellation.stars.filter((star) => star.kind === "plan");
  const badge = HEALTH_BADGE[health.tone];
  return (
    <article className={styles.atlasTile} data-health={health.tone}>
    <button
      type="button"
      onClick={() => onOpen(constellation.rootId)}
      aria-label={`Открыть созвездие «${root.label}»`}
      className={styles.atlasOpen}
    >
      <div className={styles.atlasMap}>
      <div className={styles.atlasMapTop} aria-hidden><span>ORION / ЦЕЛЬ</span><span>✦ СОЗВЕЗДИЕ</span></div>
      {constellation.stars.length === 1 ? (
        <div className={styles.atlasEmptyMap}>
          <Sparkles className="h-8 w-8" strokeWidth={1} aria-hidden />
          <span>Откройте и задайте первый шаг</span>
        </div>
      ) : <SkyCanvas constellation={constellation} goals={goals} lens="progress" selectedId={health.next?.id ?? null} mode="mini" />}
      <span className={styles.atlasExplore} aria-hidden>Исследовать <ArrowUpRight size={13} /></span>
      </div>
      <div className={styles.atlasBody}>
      <div className={styles.atlasTitle}>
        {trophy ? <Trophy className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> : null}
        <span className={styles.atlasName}>{root.label}</span>
        <span className={styles.atlasPercent}>{root.progress === null ? "—" : `${root.progress}%`}</span>
      </div>
      {trophy ? (
        <p className={styles.atlasSummary}>Достигнута · последнее изменение {goal ? shortDate(goal.updatedAt) : ""}</p>
      ) : (
        <>
          <div className={styles.atlasBadges}>
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
            <p className={styles.atlasSummary}>
              Дальше: {health.next.nextTask.title} <span className="opacity-70">· {health.next.label}</span>
            </p>
          ) : <p className={styles.atlasSummary}>{plans.length === 0 ? "Добавьте проект или подцель, чтобы появился маршрут." : "Выберите проект и задайте следующий шаг."}</p>}
        </>
      )}
      </div>
    </button>
    {plans.length > 0 && !trophy ? (
      <div className={styles.atlasProjects} aria-label={`Проекты цели «${root.label}»`}>
        <span className={styles.atlasProjectsHeading}>ПРОЕКТЫ НА МАРШРУТЕ</span>
        {plans.slice(0, 3).map((plan) => (
          <button key={plan.id} type="button" className={styles.atlasProject} onClick={() => plan.projectId && openProject(plan.projectId, plan.label)}>
            <FolderKanban size={13} aria-hidden />
            <span title={plan.label}>{plan.label}</span>
            <small>{plan.progress === null ? "—" : `${plan.progress}%`}</small>
            <ArrowUpRight size={13} aria-hidden />
          </button>
        ))}
        {plans.length > 3 ? <span className={styles.atlasMore}>Ещё {plans.length - 3} на карте</span> : null}
      </div>
    ) : null}
    </article>
  );
}

const GRID = styles.atlasGrid;

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
    <div className={styles.atlasOverview}>
      <div className="space-y-4">
        <div className={styles.atlasIntro}>
          <div><span className={styles.atlasEyebrow}>АТЛАС ВАШИХ РЕЗУЛЬТАТОВ</span><h2>Ваши созвездия</h2><p>Каждый маршрут ведёт от проектов и шагов к результату.</p></div>
          <div className={styles.atlasCount}><strong>{active.length}</strong><span>в работе</span><small>{attention > 0 ? `${attention} требуют внимания` : `${moving} в движении`}</small></div>
        </div>
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
