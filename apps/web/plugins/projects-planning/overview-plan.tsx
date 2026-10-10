"use client";

import type { Milestone, Task } from "@orion/shared-types";
import { Button, PanelSection, cx } from "@orion/ui";
import { Flag } from "lucide-react";
import type { ProjectOverviewPlanSlotProps } from "../../lib/extensions/contracts";
import { shortDate } from "../../lib/format";
import { planStrip, type PlanStepState } from "../../lib/project-status";

const STEP_BAR: Record<PlanStepState, string> = {
  done: "bg-success",
  current: "bg-accent",
  overdue: "bg-destructive",
  upcoming: "bg-white/[0.08]"
};

const STEP_WORD: Record<PlanStepState, string> = {
  done: "готово",
  current: "сейчас",
  overdue: "просрочено",
  upcoming: "впереди"
};

/**
 * The plan as a stepper: one segment per milestone, in the project's own order.
 * It is a *summary* of the plan, not a second planner — a click goes to the real
 * Gantt tab. Long plans scroll inside the strip instead of widening the page.
 */
function PlanStrip({
  milestones,
  tasks,
  onOpenPlan
}: {
  milestones: readonly Milestone[];
  tasks: readonly Task[];
  onOpenPlan: () => void;
}): React.ReactElement {
  const steps = planStrip(milestones, tasks);
  return (
    <ol className="orion-scroll -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" aria-label="План по вехам">
      {steps.map((step) => {
        const tally = step.total === 0 ? "задач нет" : `${step.closed}/${step.total}`;
        const due = step.milestone.dueAt ? ` · до ${shortDate(step.milestone.dueAt)}` : "";
        return (
          <li key={step.milestone.id} className="min-w-[8.5rem] flex-1 snap-start" aria-current={step.state === "current" ? "step" : undefined}>
            <button
              type="button"
              onClick={onOpenPlan}
              title="Открыть план"
              className="group flex w-full flex-col gap-1.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span className={cx("h-1.5 w-full rounded-full", STEP_BAR[step.state])} aria-hidden />
              <span
                className={cx(
                  "truncate text-label",
                  step.state === "upcoming" ? "text-muted-foreground" : "text-foreground",
                  step.state === "done" && "line-through decoration-white/20"
                )}
              >
                {step.milestone.title}
              </span>
              <span className={cx("text-micro", step.state === "overdue" ? "text-destructive" : "text-subtle-foreground")}>
                <span className="sr-only">{STEP_WORD[step.state]}, </span>
                {step.state === "overdue" ? "просрочено · " : step.state === "current" ? "сейчас · " : ""}
                {tally}
                {due}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Used by the empty state of the plan block: a pointer, not a form. */
function PlanEmptyHint({ onOpenPlan }: { onOpenPlan: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onOpenPlan}
      className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-left text-label text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
    >
      <Flag className="h-4 w-4 shrink-0" aria-hidden />
      Разбейте проект на этапы-вехи — здесь появится лента плана.
    </button>
  );
}


/** Plugin `projects-planning`: the «План» block of the project overview (stepper of milestones, or a hint to make some). */
export function ProjectOverviewPlan({ milestones, tasks, onOpenPlan }: ProjectOverviewPlanSlotProps): React.ReactElement {
  return (
    <PanelSection
      title="План"
      actions={
        <Button size="sm" variant="ghost" onClick={onOpenPlan}>
          Открыть план
        </Button>
      }
    >
      {milestones.length > 0 ? <PlanStrip milestones={milestones} tasks={tasks} onOpenPlan={onOpenPlan} /> : <PlanEmptyHint onOpenPlan={onOpenPlan} />}
    </PanelSection>
  );
}
