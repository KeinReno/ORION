"use client";

import { PROJECT_STATUS_ORDER, type ProjectStatus } from "@orion/shared-types";
import { Badge, DropdownMenu } from "@orion/ui";
import { Check, ChevronDown } from "lucide-react";
import { shortDate } from "../../lib/format";
import { projectDueLabel, type ProjectNextAction } from "../../lib/project-status";
import { PROJECT_STATUS_LABEL } from "../project-form";
import { STATUS_TONE } from "../../components/project-bits";

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

/**
 * The project's status as a control, not a label: one click changes it
 * (active / paused / finished) without opening the edit form. Shown in the
 * header on every project, including the default "active" one, because the
 * affordance matters more than hiding the norm there.
 */
export function ProjectStatusMenu({
  status,
  disabled,
  onChange
}: {
  status: ProjectStatus;
  disabled?: boolean;
  onChange: (status: ProjectStatus) => void;
}): React.ReactElement {
  return (
    <DropdownMenu
      align="start"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-label={`Статус проекта: ${PROJECT_STATUS_LABEL[status]}. Изменить`}
          className="inline-flex items-center gap-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60"
        >
          <Badge tone={STATUS_TONE[status]}>{PROJECT_STATUS_LABEL[status]}</Badge>
          <ChevronDown className="h-3 w-3 text-subtle-foreground" aria-hidden />
        </button>
      )}
      items={PROJECT_STATUS_ORDER.map((value) => ({
        label: PROJECT_STATUS_LABEL[value],
        icon: value === status ? Check : undefined,
        onSelect: () => {
          if (value !== status) onChange(value);
        }
      }))}
    />
  );
}

/**
 * "What is happening here" in one line, for a board row or card: the next
 * actionable task, or an honest reason there is none. Silent for paused,
 * finished or archived projects (nothing is expected of them).
 */
export function NextLine({
  live,
  tasksCount,
  nextAction
}: {
  live: boolean;
  tasksCount: number;
  nextAction: ProjectNextAction | undefined;
}): React.ReactElement | null {
  if (!live) return null;
  if (tasksCount === 0) return <span className="text-subtle-foreground">Задач пока нет</span>;
  if (nextAction?.next) {
    return (
      <>
        <span className="text-subtle-foreground">Дальше · </span>
        <span className="text-foreground">{nextAction.next.title}</span>
      </>
    );
  }
  if (nextAction && nextAction.open > 0) return <span className="text-subtle-foreground">Всё открытое ждёт зависимостей</span>;
  return <span className="text-success">Все задачи закрыты</span>;
}
