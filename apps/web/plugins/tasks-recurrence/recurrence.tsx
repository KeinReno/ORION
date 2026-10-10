"use client";

import { Input, Select, cx } from "@orion/ui";
import { Repeat } from "lucide-react";
import type { TaskRecurrenceApi } from "../../lib/extensions/contracts";
import { TASK_RECURRENCE_LABEL } from "../../lib/task-labels";

const FREQS = ["daily", "weekly", "monthly", "yearly"] as const;

/**
 * Plugin `tasks-recurrence`: «Повтор» / «Каждые N» in the task forms and the repeat mark on the card.
 * What a repeating task DOES (the next copy appears when it is completed) is server logic and does not
 * depend on this plugin; with it off the fields are simply not shown and the stored rule is kept as is.
 */
export const taskRecurrenceApi: TaskRecurrenceApi = {
  Fields({ variant, freq, interval, onFreqChange, onIntervalChange }) {
    const labelClass = (extra?: string): string =>
      variant === "detail"
        ? cx("flex min-w-0 flex-col gap-1 text-label text-subtle-foreground", extra)
        : "flex flex-col gap-1 text-label text-subtle-foreground";
    return (
      <>
        <label className={labelClass()}>
          Повтор
          <Select value={freq} onChange={(event) => onFreqChange(event.target.value as (typeof FREQS)[number] | "")}>
            <option value="">Не повторяется</option>
            {FREQS.map((value) => (
              <option key={value} value={value}>
                {TASK_RECURRENCE_LABEL[value]}
              </option>
            ))}
          </Select>
        </label>
        {freq ? (
          <label className={labelClass()}>
            Каждые N
            <Input type="number" min={1} max={365} value={interval} onChange={(event) => onIntervalChange(event.target.value)} />
          </label>
        ) : null}
      </>
    );
  },

  CardMark() {
    return (
      <span className="inline-flex items-center gap-1 text-micro text-subtle-foreground" title="Повторяющаяся задача">
        <Repeat className="h-3 w-3" />
      </span>
    );
  }
};
