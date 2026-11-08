"use client";

import type { UserPreference } from "@orion/shared-types";
import { Button, Card, Input } from "@orion/ui";
import { useEffect, useId, useMemo, useState } from "react";
import { ChoiceSelect } from "../../components/choice-select";

/** IANA zones the runtime knows; empty on an engine without `Intl.supportedValuesOf` (validation still works). */
function knownTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

/** The server does not validate the zone and silently falls back on a bad one, so only a real zone is saved. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * «Дата и время»: the time zone quiet hours and reminders are counted in, and the first day of the
 * week. Applied at once like the rest of the personal preferences; an unknown zone stays in the
 * field with an explanation and is not saved.
 */
export function RegionSettings({
  timeZone,
  weekStartsOn,
  onChange
}: {
  timeZone: string | null;
  weekStartsOn: number;
  onChange: (patch: Pick<Partial<UserPreference>, "timeZone" | "weekStartsOn">) => void;
}): React.ReactElement {
  const ids = useId();
  const zones = useMemo(knownTimeZones, []);
  const device = useMemo(deviceTimeZone, []);
  const [draft, setDraft] = useState(timeZone ?? "");
  useEffect(() => setDraft(timeZone ?? ""), [timeZone]);
  const trimmed = draft.trim();
  const invalid = trimmed !== "" && !isValidTimeZone(trimmed);

  function commit(value: string): void {
    setDraft(value);
    const next = value.trim();
    if (next === "") onChange({ timeZone: null });
    else if (isValidTimeZone(next)) onChange({ timeZone: next });
  }

  return (
    <Card className="space-y-4">
      <div data-setting="time-zone" className="flex flex-col gap-1">
        <label htmlFor={`${ids}-zone`} className="text-xs text-muted-foreground">
          Часовой пояс
        </label>
        <div className="flex w-full flex-wrap items-center gap-2">
          <Input
            id={`${ids}-zone`}
            list={`${ids}-zones`}
            placeholder="Как на сервере"
            value={draft}
            aria-invalid={invalid}
            onChange={(event) => commit(event.target.value)}
            className="min-w-0 flex-1"
          />
          {device && device !== timeZone ? (
            <Button type="button" size="sm" variant="outline" onClick={() => commit(device)}>
              Как на этом компьютере ({device})
            </Button>
          ) : null}
          {timeZone ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => commit("")}>
              Как на сервере
            </Button>
          ) : null}
        </div>
        <datalist id={`${ids}-zones`}>
          {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        {invalid ? (
          <p role="alert" className="text-2xs text-destructive">
            Такого часового пояса нет — выберите из списка, например Europe/Moscow. Пока сохранён прежний: {timeZone ?? "как на сервере"}.
          </p>
        ) : (
          <p className="text-2xs text-subtle-foreground">
            По нему считаются тихие часы и время напоминаний. Пустое поле — часовой пояс сервера ORION.
          </p>
        )}
      </div>
      <div data-setting="week-start" className="flex flex-col items-start gap-1">
        <label htmlFor={`${ids}-week`} className="text-xs text-muted-foreground">
          Начало недели
        </label>
        <ChoiceSelect
          id={`${ids}-week`}
          label="Начало недели"
          value={weekStartsOn === 0 ? "0" : "1"}
          options={[{ value: "1", label: "С понедельника" }, { value: "0", label: "С воскресенья" }]}
          onChange={(next) => onChange({ weekStartsOn: next === "0" ? 0 : 1 })}
        />
      </div>
    </Card>
  );
}
