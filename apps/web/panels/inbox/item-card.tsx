"use client";

import type { InboxItem, OrionModuleId } from "@orion/shared-types";
import { Badge, Button, IconButton, cx } from "@orion/ui";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { CalendarDays, Clock, FolderKanban, ListTodo, StickyNote, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { relativeTime, shortDateTime } from "../../lib/format";

export type ProcessKind = "task" | "note" | "event";

type CardHandlers = {
  projectNames: Map<string, string>;
  isEnabled: (id: OrionModuleId) => boolean;
  processPending: boolean;
  onProcessToday: (item: InboxItem) => void;
  onOpenProcess: (item: InboxItem, kind: ProcessKind) => void;
  onDelete: (item: InboxItem) => void;
};

/**
 * The one thought being triaged. Title is the surface; actions sit underneath
 * as one primary path plus quiet conversions — not four equal chips on a
 * shadowed card.
 */
export function InboxFocus({
  item,
  index,
  total,
  projectNames,
  isEnabled,
  processPending,
  onProcessToday,
  onOpenProcess,
  onDelete
}: { item: InboxItem; index: number; total: number } & CardHandlers): React.ReactElement {
  const canToday = isEnabled("tasks");
  const canNote = isEnabled("notes");
  const canEvent = isEnabled("calendar");
  const hasTarget = canToday || canNote || canEvent;

  return (
    <InboxSwipe
      canToday={canToday && !processPending}
      onToday={() => onProcessToday(item)}
      onDelete={() => onDelete(item)}
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card/70">
        <div className="px-4 pb-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <p className="min-w-0 break-words text-xl font-medium leading-snug tracking-tight text-foreground">{item.title || "Без названия"}</p>
            <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-label tabular-nums text-accent-text" aria-label={`Запись ${index} из ${total}`}>
              {index} / {total}
            </span>
          </div>
          {item.body ? <p className="mt-3 whitespace-pre-wrap text-body text-muted-foreground">{item.body}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-label text-subtle-foreground">
            <span>{relativeTime(item.createdAt)}</span>
            {item.projectId ? (
              <Badge>
                <FolderKanban className="h-3 w-3" /> {projectNames.get(item.projectId) ?? "Проект"}
              </Badge>
            ) : null}
            {item.dueAt ? (
              <Badge>
                <Clock className="h-3 w-3" /> {shortDateTime(item.dueAt)}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 bg-panel/45 px-3 py-3 sm:px-5">
          {canToday ? (
            <Button size="sm" onClick={() => onProcessToday(item)} disabled={processPending} className="min-h-9">
              <ListTodo className="h-3.5 w-3.5" /> На сегодня
            </Button>
          ) : null}
          <div className="flex flex-wrap items-center gap-1 text-label">
            {canToday ? (
              <QuietAction disabled={processPending} onClick={() => onOpenProcess(item, "task")}>
                <ListTodo className="h-3.5 w-3.5" aria-hidden="true" /> В задачу
              </QuietAction>
            ) : null}
            {canNote ? (
              <QuietAction disabled={processPending} onClick={() => onOpenProcess(item, "note")}>
                <StickyNote className="h-3.5 w-3.5" aria-hidden="true" /> В заметку
              </QuietAction>
            ) : null}
            {canEvent ? (
              <QuietAction disabled={processPending} onClick={() => onOpenProcess(item, "event")}>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> В событие
              </QuietAction>
            ) : null}
          </div>
          <IconButton className="ml-auto h-9 w-9" label="Удалить запись" size="sm" tone="danger" onClick={() => onDelete(item)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
        {!hasTarget ? (
          <p className="border-t border-border/70 px-4 py-3 text-label text-subtle-foreground">Нет включённых модулей, в которые можно разобрать запись.</p>
        ) : null}
      </div>
    </InboxSwipe>
  );
}

/** Remaining queue — one line each, click brings the thought to the front. */
export function InboxQueueRow({
  item,
  active,
  onSelect
}: {
  item: InboxItem;
  active: boolean;
  onSelect: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cx(
        "flex w-full items-baseline gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors",
        "hover:bg-ui-hover focus-visible:ring-2 focus-visible:ring-accent/60",
        active && "bg-accent/[0.07]"
      )}
    >
      <span className={cx("min-w-0 flex-1 truncate text-body", active ? "text-foreground" : "text-muted-foreground")}>
        {item.title || "Без названия"}
      </span>
      <span className="shrink-0 text-micro text-subtle-foreground">{relativeTime(item.createdAt)}</span>
    </button>
  );
}

function QuietAction({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground outline-none transition-colors hover:bg-ui-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

const SWIPE = 96;

function InboxSwipe({
  canToday,
  onToday,
  onDelete,
  children
}: {
  canToday: boolean;
  onToday: () => void;
  onDelete: () => void;
  children: ReactNode;
}): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const todayOpacity = useTransform(x, [20, SWIPE], [0, 1]);
  const deleteOpacity = useTransform(x, [-SWIPE, -20], [1, 0]);

  function settle(to: number, then?: () => void): void {
    const finish = (): void => {
      then?.();
      if (to !== 0) x.set(0);
    };
    if (reduceMotion) {
      x.set(to);
      finish();
      return;
    }
    void animate(x, to, { type: "spring", stiffness: 400, damping: 30, onComplete: finish });
  }

  if (reduceMotion) return <div>{children}</div>;

  return (
    <div className="relative overflow-hidden rounded-xl">
      <motion.div
        style={{ opacity: todayOpacity }}
        className="pointer-events-none absolute inset-y-0 left-0 flex w-28 items-center pl-3 text-label font-medium text-success"
      >
        На сегодня
      </motion.div>
      <motion.div
        style={{ opacity: deleteOpacity }}
        className="pointer-events-none absolute inset-y-0 right-0 flex w-28 items-center justify-end pr-3 text-label font-medium text-destructive"
      >
        Удалить
      </motion.div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: canToday ? -160 : -160, right: canToday ? 160 : 0 }}
        dragElastic={0.12}
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={(_event, info) => {
          if (info.offset.x > SWIPE && canToday) {
            settle(SWIPE, onToday);
            return;
          }
          if (info.offset.x < -SWIPE) {
            settle(-SWIPE, onDelete);
            return;
          }
          settle(0);
        }}
        className="relative z-10"
      >
        {children}
      </motion.div>
    </div>
  );
}
