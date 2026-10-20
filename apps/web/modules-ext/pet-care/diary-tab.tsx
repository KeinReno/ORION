"use client";

import { addPetDays, computePetAlerts, computePetStats, petPlural, type PetCarePet } from "@orion/shared-types";
import { Skeleton, StatCard } from "@orion/ui";
import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { petLocalDayKey, petMonthGrid, toPetDayRecord } from "../../lib/pet-care-days";
import { PetDayForm } from "./day-form";
import { PetDayEvents } from "./events";
import { PetMonthCalendar, type PetCalendarMark, type PetMonthCursor } from "./month-calendar";
import { usePetCareDays, usePetCareEvents } from "./use-pet-care";

/** Дневник: календарь месяца, тревожные сигналы, сводка за 30 дней и запись выбранного дня. */
const BAD_TONE = "border-destructive/40 bg-destructive/[0.06]";
const GOOD_TONE = "border-success/30";

export function PetDiaryTab({ workspaceId, pet }: { workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const today = petLocalDayKey();
  const [selected, setSelected] = useState(today);
  const [cursor, setCursor] = useState<PetMonthCursor>({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });

  const grid = useMemo(() => petMonthGrid(cursor.year, cursor.month), [cursor]);
  const gridFrom = grid[0]!.day;
  const gridTo = grid[grid.length - 1]!.day;
  const monthDays = usePetCareDays(workspaceId, pet.id, gridFrom, gridTo);
  const monthEvents = usePetCareEvents(workspaceId, pet.id, gridFrom, gridTo);
  const recentFrom = addPetDays(today, -34);
  const recent = usePetCareDays(workspaceId, pet.id, recentFrom, today);
  const selectedDay = usePetCareDays(workspaceId, pet.id, selected, selected);

  const marks = useMemo(() => {
    const map = new Map<string, PetCalendarMark>();
    for (const day of monthDays.data ?? []) map.set(day.day, { status: day.status, hasNote: day.note.trim() !== "", symptomCount: day.symptoms.length });
    return map;
  }, [monthDays.data]);
  const eventDays = useMemo(() => new Set((monthEvents.data ?? []).map((event) => event.day)), [monthEvents.data]);

  const recentRecords = useMemo(() => (recent.data ?? []).map(toPetDayRecord), [recent.data]);
  const alerts = useMemo(() => computePetAlerts(recentRecords, today), [recentRecords, today]);
  const stats = useMemo(() => computePetStats(recentRecords.filter((day) => day.day >= addPetDays(today, -29)), addPetDays(today, -29), today), [recentRecords, today]);
  const weightDelta = stats.weightFirst != null && stats.weightLast != null ? Math.round((stats.weightLast - stats.weightFirst) * 100) / 100 : null;

  function pick(day: string): void {
    setSelected(day);
    // Выбор дня из соседнего месяца (серые клетки сетки) переключает и календарь.
    setCursor({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) });
  }

  const existing = selectedDay.data?.[0];

  return (
    <div className="space-y-3">
      {alerts.length > 0 ? (
        <section className="space-y-1.5" aria-label="Тревожные сигналы">
          {alerts.map((alert) => (
            <div
              key={alert.title}
              role="alert"
              className={
                alert.level === "danger"
                  ? "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                  : "flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
              }
            >
              <TriangleAlert className={alert.level === "danger" ? "mt-0.5 h-4 w-4 shrink-0 text-destructive" : "mt-0.5 h-4 w-4 shrink-0 text-warning"} aria-hidden />
              <div>
                <div className="font-medium">{alert.title}</div>
                <div className="text-xs text-muted-foreground">{alert.detail}</div>
              </div>
            </div>
          ))}
          <p className="text-2xs text-muted-foreground">Подсказки по вашим же отметкам, не диагноз. При сомнениях обратитесь к ветеринару.</p>
        </section>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-3">
          <PetMonthCalendar cursor={cursor} onCursor={setCursor} selected={selected} today={today} marks={marks} eventDays={eventDays} onPick={pick} />
          {/* The same six figures as MurHP's «за 30 дней»; a worrying one is tinted (MurHP's tone rules). */}
          <div className="grid grid-cols-3 gap-2" aria-label="За 30 дней">
            <StatCard
              label="Плохих"
              value={stats.badOrWorse}
              hint={`${petPlural(stats.badOrWorse, "день", "дня", "дней")} из ${stats.loggedDays}`}
              className={stats.badOrWorse > 0 ? BAD_TONE : GOOD_TONE}
            />
            <StatCard label="Рвота" value={stats.vomitingEpisodes} hint="эпизодов" />
            <StatCard label="Жидкий стул" value={stats.looseStoolDays} hint={petPlural(stats.looseStoolDays, "день", "дня", "дней")} />
            <StatCard label="Вялость" value={stats.lethargyDays} hint={petPlural(stats.lethargyDays, "день", "дня", "дней")} />
            <StatCard label="Серия плохих" value={stats.longestBadStreak} hint="подряд, максимум" className={stats.longestBadStreak >= 3 ? BAD_TONE : undefined} />
            <StatCard
              label="Вес"
              value={weightDelta === null ? "—" : `${weightDelta > 0 ? "+" : ""}${weightDelta}`}
              hint={weightDelta === null ? "не отмечался" : "кг за месяц"}
              className={weightDelta !== null && weightDelta <= -0.2 ? BAD_TONE : undefined}
            />
          </div>
        </div>

        <div className="space-y-3">
          {selectedDay.isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <PetDayForm
              key={`${pet.id}:${selected}:${existing?.updatedAt ?? "new"}`}
              workspaceId={workspaceId}
              pet={pet}
              day={selected}
              existing={existing}
              today={today}
              onStep={(delta) => pick(addPetDays(selected, delta))}
            />
          )}
          <PetDayEvents workspaceId={workspaceId} pet={pet} day={selected} />
        </div>
      </div>
    </div>
  );
}
