"use client";

import { Button, cx, useMotionLevel } from "@orion/ui";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * The building blocks every settings tab is laid out with: a titled group (one card, rows divided
 * by hairlines), a row with the name and a short explanation on the left and the control on the
 * right (stacked on a narrow panel), and — for the forms that save on a button — a bar pinned to
 * the bottom of the panel while something is unsaved. Rows of tabs that apply at once never mark
 * themselves changed: there is nothing pending to mark.
 */
export function SettingGroup({
  title,
  description,
  children,
  className
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={cx("space-y-2", className)} aria-label={title}>
      <header className="px-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? <p className="text-2xs text-subtle-foreground">{description}</p> : null}
      </header>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card">{children}</div>
    </section>
  );
}

export function SettingRow({
  label,
  description,
  anchor,
  changed = false,
  stack = false,
  children
}: {
  label: ReactNode;
  description?: ReactNode;
  /** `data-setting` the parameter search scrolls to (`lib/settings-catalog.ts`). */
  anchor?: string;
  /** The value differs from the saved one (forms with a Save button only). */
  changed?: boolean;
  /** The control is wide (a long segmented choice, sliders): put it under the text instead of beside it. */
  stack?: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div
      data-setting={anchor}
      className={cx(
        "grid gap-x-6 gap-y-2 px-4 py-3",
        !stack && "[@container(min-width:576px)]:grid-cols-[minmax(0,1fr)_auto] [@container(min-width:576px)]:items-center"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span>{label}</span>
          {changed ? (
            <span className="inline-flex items-center gap-1 text-2xs text-accent-text">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              изменено
            </span>
          ) : null}
        </div>
        {description ? <p className="mt-0.5 text-2xs text-subtle-foreground">{description}</p> : null}
      </div>
      <div className={cx("min-w-0", !stack && "[@container(min-width:576px)]:justify-self-end")}>{children}</div>
    </div>
  );
}

/**
 * Pinned to the bottom of the settings panel while a Save-button form has unsaved changes: the
 * count of changed fields, «Отменить» back to the saved values and the submit for `form`.
 */
export function SaveBar({
  form,
  changedCount,
  pending,
  onReset,
  saveLabel = "Сохранить"
}: {
  /** id of the <form> the Save button submits. */
  form: string;
  changedCount: number;
  pending: boolean;
  onReset: () => void;
  saveLabel?: string;
}): React.ReactElement {
  const still = useMotionLevel() === "off";
  return (
    <AnimatePresence initial={false}>
      {changedCount > 0 ? (
        <motion.div
          role="region"
          aria-label="Несохранённые изменения"
          initial={still ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-panel px-4 py-2.5 shadow-lg"
        >
          <span className="text-label text-muted-foreground" aria-live="polite">
            {changedCount === 1 ? "Изменено одно поле" : `Изменено полей: ${changedCount}`} — ещё не сохранено
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onReset}>
              Отменить
            </Button>
            <Button type="submit" size="sm" form={form} status={pending ? "pending" : "idle"}>
              {saveLabel}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
