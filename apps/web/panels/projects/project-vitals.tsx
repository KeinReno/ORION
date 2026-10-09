"use client";

import type { Milestone, Task } from "@orion/shared-types";
import { Badge, cx } from "@orion/ui";
import { Flag } from "lucide-react";
import { shortDate } from "../../lib/format";
import { planStrip, projectDueLabel, type PlanStepState } from "../../lib/project-status";

/**
 * Small, reusable pieces that let a project say how it is doing in the same
 * words everywhere (board card, project header, overview): the deadline phrase
 * and the plan as a stepper. Colour is never the only signal — every tone
 * carries a word or an icon (Badge adds the icon), and the stepper's state is
 * also in text for screen readers.
 */

/** "через 12 дней" / "срок сегодня" / "просрочен на 3 дня" / "Завершён". Nothing without a deadline. */
export function DueChip({
  project
}: {
  project: { status: string; dueAt: string | null };
}): React.ReactElement | null {
  const label = projectDueLabel(project);
  if (!label) return null;
  const title = project.dueAt ? `Срок: ${shortDate(project.dueAt)}` : undefined;
  return (
    <span title={title}>
      <Badge tone={label.tone}>{label.text}</Badge>
    </span>
  );
}

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
export function PlanStrip({
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
export function PlanEmptyHint({ onOpenPlan }: { onOpenPlan: () => void }): React.ReactElement {
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
