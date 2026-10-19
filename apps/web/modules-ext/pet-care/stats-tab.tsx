"use client";

import { addPetDays, computePetStats, petPlural, type PetCarePet } from "@orion/shared-types";
import { Card, EmptyState, SegmentedControl, Skeleton, StatCard } from "@orion/ui";
import { ChartColumn } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError } from "../../lib/error-message";
import { petLocalDayKey, toPetDayRecord } from "../../lib/pet-care-days";
import { StatusDistribution, SymptomBars, WeightChart } from "./charts";
import { usePetCareDays } from "./use-pet-care";

const PERIODS = [
  { value: "30", label: "30 дней" },
  { value: "90", label: "3 месяца" },
  { value: "180", label: "Полгода" },
  { value: "365", label: "Год" }
] as const;

/** Вкладка «Статистика»: плохие дни, рвота, стул, серии, частота симптомов, динамика веса. */
export function PetStatsTab({ workspaceId, pet }: { workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("30");
  const today = petLocalDayKey();
  const from = addPetDays(today, -(Number(period) - 1));
  const days = usePetCareDays(workspaceId, pet.id, from, today);
  const records = useMemo(() => (days.data ?? []).map(toPetDayRecord), [days.data]);
  const stats = useMemo(() => computePetStats(records, from, today), [records, from, today]);
  const weights = useMemo(() => (days.data ?? []).filter((day) => day.weightKg != null).map((day) => ({ day: day.day, weight: day.weightKg! })), [days.data]);
  const weightDelta = stats.weightFirst != null && stats.weightLast != null ? Math.round((stats.weightLast - stats.weightFirst) * 100) / 100 : null;
  const daysWord = (n: number): string => petPlural(n, "день", "дня", "дней");

  return (
    <div className="space-y-3">
      <SegmentedControl options={[...PERIODS]} value={period} onChange={setPeriod} aria-label="Период статистики" />
      {days.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : days.isError ? (
        <EmptyState icon={ChartColumn} tone="danger" title="Не удалось загрузить дни" description={describeError(days.error)} />
      ) : stats.loggedDays === 0 ? (
        <EmptyState icon={ChartColumn} title="За период нет записей" description="Отметьте самочувствие в дневнике — здесь появится статистика." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Плохих дней" value={stats.badOrWorse} hint={`из ${stats.loggedDays} отмеченных`} />
            <StatCard label="Рвота" value={stats.vomitingEpisodes} hint={`в ${stats.vomitingDays} ${daysWord(stats.vomitingDays)}`} />
            <StatCard label="Жидкий стул" value={stats.looseStoolDays} hint={daysWord(stats.looseStoolDays)} />
            <StatCard label="Вялость" value={stats.lethargyDays} hint={`${daysWord(stats.lethargyDays)} со сниженной активностью`} />
            <StatCard label="Серия плохих" value={stats.longestBadStreak} hint="дней подряд, максимум" />
            <StatCard label="Вес" value={weightDelta === null ? "—" : `${weightDelta > 0 ? "+" : ""}${weightDelta}`} hint={weightDelta === null ? "не отмечался" : `кг (${stats.weightFirst} → ${stats.weightLast})`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-3">
              <h3 className="mb-2 text-sm font-semibold">Частота симптомов</h3>
              {stats.symptomFreq.length === 0 ? <p className="text-sm text-muted-foreground">За период симптомы не отмечались.</p> : <SymptomBars items={stats.symptomFreq.slice(0, 8)} />}
            </Card>
            <Card className="p-3">
              <h3 className="mb-2 text-sm font-semibold">Динамика веса</h3>
              {weights.length < 2 ? <p className="text-sm text-muted-foreground">Нужно минимум две записи веса.</p> : <WeightChart points={weights} />}
            </Card>
          </div>
          <Card className="p-3">
            <h3 className="mb-2 text-sm font-semibold">Распределение по состоянию</h3>
            <StatusDistribution stats={stats} />
          </Card>
        </>
      )}
    </div>
  );
}
