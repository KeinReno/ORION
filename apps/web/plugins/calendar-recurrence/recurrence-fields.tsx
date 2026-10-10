"use client";

import { describeRecurrence, WEEKDAY_RU_SHORT, type RecurrenceFreq, type RecurrenceSpec } from "@orion/shared-types";
import { Input, Select } from "@orion/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { fromDateInput, toDateInput } from "../../lib/date-input";
import type { EventRecurrenceSlotProps } from "../../lib/extensions/contracts";

const FREQ_OPTIONS: { value: RecurrenceFreq | "none"; label: string }[] = [
  { value: "none", label: "Не повторять" },
  { value: "daily", label: "Ежедневно" },
  { value: "weekly", label: "Еженедельно" },
  { value: "monthly", label: "Ежемесячно" },
  { value: "yearly", label: "Ежегодно" }
];

/**
 * Plugin `calendar-recurrence`: the «Повтор» section of the event form. It starts from the event's rule
 * and reports every change as one `RecurrenceSpec | null`; expanding a series into occurrences stays
 * on the server and in the calendar grid, so existing recurring events do not depend on this plugin.
 */
export function EventRecurrenceFields({ value, onChange }: EventRecurrenceSlotProps): React.ReactElement {
  const [freq, setFreq] = useState<RecurrenceFreq | "none">(value?.freq ?? "none");
  const [interval, setIntervalValue] = useState(value?.interval ?? 1);
  const [byWeekday, setByWeekday] = useState<number[]>(value?.byWeekday ?? []);
  const [endMode, setEndMode] = useState<"never" | "until" | "count">(value?.until ? "until" : value?.count ? "count" : "never");
  const [until, setUntil] = useState(value?.until ? toDateInput(value.until) : "");
  const [count, setCount] = useState(value?.count ?? 10);

  const recurrence = useMemo<RecurrenceSpec | null>(() => {
    if (freq === "none") return null;
    return {
      freq,
      interval: Math.max(1, interval),
      byWeekday: freq === "weekly" && byWeekday.length > 0 ? [...byWeekday].sort((a, b) => a - b) : undefined,
      until: endMode === "until" && until ? new Date(fromDateInput(until)).toISOString() : null,
      count: endMode === "count" ? Math.max(1, count) : null
    };
  }, [freq, interval, byWeekday, endMode, until, count]);

  // Report changes, but not the initial value back (that would mark an untouched form as edited).
  const first = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChangeRef.current(recurrence);
  }, [recurrence]);

  return (
    <fieldset className="rounded-lg border border-border p-2.5">
      <legend className="px-1 text-2xs text-subtle-foreground">Повтор</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFreq | "none")}>
          {FREQ_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {freq !== "none" ? (
          <label className="flex items-center gap-1 text-2xs text-subtle-foreground">
            каждые
            <Input
              type="number"
              min={1}
              max={365}
              value={interval}
              onChange={(e) => setIntervalValue(Number(e.target.value) || 1)}
              className="w-16"
            />
          </label>
        ) : null}
      </div>

      {freq === "weekly" ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {WEEKDAY_RU_SHORT.map((label, wd) => (
            <button
              key={wd}
              type="button"
              onClick={() => setByWeekday((prev) => (prev.includes(wd) ? prev.filter((x) => x !== wd) : [...prev, wd]))}
              className={
                byWeekday.includes(wd)
                  ? "rounded border border-accent bg-accent/15 px-1.5 py-0.5 text-2xs text-accent-text"
                  : "rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {freq !== "none" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={endMode} onChange={(e) => setEndMode(e.target.value as "never" | "until" | "count")}>
            <option value="never">бессрочно</option>
            <option value="until">до даты</option>
            <option value="count">N раз</option>
          </Select>
          {endMode === "until" ? <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /> : null}
          {endMode === "count" ? (
            <Input
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
              className="w-20"
            />
          ) : null}
        </div>
      ) : null}

      {recurrence ? <p className="mt-2 text-2xs text-subtle-foreground">{describeRecurrence(recurrence)}</p> : null}
    </fieldset>
  );
}
