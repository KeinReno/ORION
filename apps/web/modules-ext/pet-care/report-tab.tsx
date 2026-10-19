"use client";

import { PET_APPETITE_LABELS, PET_DAY_STATUS_META, PET_STOOL_LABELS, addPetDays, computePetStats, petPlural, type PetCarePet } from "@orion/shared-types";
import { Button, Card, Input, Skeleton } from "@orion/ui";
import { FileDown, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { petAgeLabel, petLocalDayKey, toPetDayRecord } from "../../lib/pet-care-days";
import { downloadPetFile, petDaysToCsv, petReportHtml, petSymptomsToCsv, symptomsLine } from "../../lib/pet-care-report";
import { usePetCareDays } from "./use-pet-care";

const QUICK = [7, 14, 30] as const;

/** Вкладка «Отчёт для ветеринара»: период, предпросмотр, скачивание (HTML для печати/PDF и CSV). */
export function PetReportTab({ workspaceId, pet }: { workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const today = petLocalDayKey();
  const [from, setFrom] = useState(addPetDays(today, -13));
  const [to, setTo] = useState(today);
  // Окно ограничено сервером (800 дней); пользователь с датой «с» старше этого получит понятное сообщение, а не пустой экран.
  const days = usePetCareDays(workspaceId, pet.id, from, to);
  const list = useMemo(() => days.data ?? [], [days.data]);
  const stats = useMemo(() => computePetStats(list.map(toPetDayRecord), from, to), [list, from, to]);
  const stamp = to.replace(/-/g, "");
  const fileBase = `pet-${pet.name.replace(/[^\p{L}\p{N}]+/gu, "-")}-${stamp}`;
  const daysWord = (n: number): string => petPlural(n, "день", "дня", "дней");

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div className="flex gap-1">
          {QUICK.map((count) => (
            <Button
              key={count}
              size="sm"
              variant="outline"
              onClick={() => {
                setFrom(addPetDays(today, -(count - 1)));
                setTo(today);
              }}
            >
              {count} дней
            </Button>
          ))}
        </div>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">с</span>
          <Input type="date" value={from} max={to} onChange={(event) => event.target.value && setFrom(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">по</span>
          <Input type="date" value={to} min={from} max={today} onChange={(event) => event.target.value && setTo(event.target.value)} />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" disabled={days.isLoading || days.isError} onClick={() => downloadPetFile(`${fileBase}.html`, petReportHtml(pet, list, from, to, new Date().toLocaleString("ru-RU")), "text/html")}>
            <FileText className="h-4 w-4" /> Отчёт (HTML → печать / PDF)
          </Button>
          <Button size="sm" variant="outline" disabled={list.length === 0} onClick={() => downloadPetFile(`${fileBase}-days.csv`, petDaysToCsv(list), "text/csv")}>
            <FileDown className="h-4 w-4" /> CSV по дням
          </Button>
          <Button size="sm" variant="outline" disabled={list.length === 0} onClick={() => downloadPetFile(`${fileBase}-symptoms.csv`, petSymptomsToCsv(list), "text/csv")}>
            <FileDown className="h-4 w-4" /> CSV по симптомам
          </Button>
        </div>
      </Card>

      {days.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : days.isError ? (
        <p className="text-sm text-destructive">Не удалось загрузить дни: окно можно запросить не больше чем на 800 дней.</p>
      ) : (
        <Card className="space-y-3 p-4">
          <header>
            <h3 className="text-base font-semibold">Дневник самочувствия — {pet.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {[pet.breed && `Порода: ${pet.breed}`, pet.birthday && `Возраст: ${petAgeLabel(pet.birthday, to)}`, `Период: ${from} — ${to}`].filter(Boolean).join(" · ")}
            </p>
            {pet.chronic || pet.allergies || pet.vetContact ? (
              <p className="text-xs text-muted-foreground">
                {[pet.chronic && `Хронические: ${pet.chronic}`, pet.allergies && `Аллергии: ${pet.allergies}`, pet.vetContact && `Ветеринар: ${pet.vetContact}`].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </header>
          <p className="rounded-md bg-white/5 px-3 py-2 text-sm">
            Отмечено дней: <b>{stats.loggedDays}</b> из {stats.totalDays}. Плохих или критических: <b>{stats.badOrWorse}</b>. Случаев рвоты: <b>{stats.vomitingEpisodes}</b> (в {stats.vomitingDays} {daysWord(stats.vomitingDays)}).
            Дней с жидким стулом: <b>{stats.looseStoolDays}</b>. Самая длинная серия плохих дней: <b>{stats.longestBadStreak}</b>.
          </p>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">За выбранный период записей нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left [&>th]:border [&>th]:border-border [&>th]:px-2 [&>th]:py-1.5">
                    <th>Дата</th>
                    <th>Состояние</th>
                    <th>Рвота</th>
                    <th>Стул</th>
                    <th>Аппетит</th>
                    <th>Вес</th>
                    <th>Симптомы / заметка</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((day) => (
                    <tr key={day.id} className="align-top [&>td]:border [&>td]:border-border [&>td]:px-2 [&>td]:py-1.5">
                      <td className="whitespace-nowrap">{day.day}</td>
                      <td className="whitespace-nowrap">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: PET_DAY_STATUS_META[day.status].color }} />
                        {PET_DAY_STATUS_META[day.status].label}
                      </td>
                      <td>{day.vomitingCount || ""}</td>
                      <td>{PET_STOOL_LABELS[day.stool]}</td>
                      <td>{PET_APPETITE_LABELS[day.appetite]}</td>
                      <td className="whitespace-nowrap">{day.weightKg != null ? `${day.weightKg} кг` : ""}</td>
                      <td>{[symptomsLine(day), day.meds, day.note].filter(Boolean).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs italic text-muted-foreground">Это субъективные наблюдения владельца, не медицинский диагноз.</p>
        </Card>
      )}
    </div>
  );
}
