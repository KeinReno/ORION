"use client";

import { useHealthToday } from "@orion/core-react";
import { HEALTH_PREVENTIVE_KIND_LABEL, habitLocalDayKey, type HealthSubject } from "@orion/shared-types";
import { Button, EmptyState, Skeleton } from "@orion/ui";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { SectionCard } from "../home/shared";

const when = (iso: string): string => new Date(iso).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayLabel = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Что требует внимания у всех, кого вы вправе видеть: ближайшие визиты и сроки профилактики. */
export function HealthToday({
  workspaceId,
  subjects,
  onOpen
}: {
  workspaceId: string | undefined;
  subjects: HealthSubject[];
  onOpen: (subjectId: string, tab: "appointments" | "preventive") => void;
}): React.ReactElement {
  const today = habitLocalDayKey();
  const { data, isLoading, isError, refetch } = useHealthToday(workspaceId, today);
  const byName = new Map(subjects.map((s) => [s.name, s.id]));

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError || !data) {
    return <EmptyState icon={ShieldCheck} title="Не удалось загрузить" action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />;
  }
  if (data.appointments.length === 0 && data.preventive.length === 0) {
    return <EmptyState icon={ShieldCheck} title="Сейчас ничего не требует внимания" description="Запланируйте визит или добавьте профилактику — ближайшее появится здесь." />;
  }
  return (
    <div className="grid gap-4 [@container(min-width:760px)]:grid-cols-2">
      <SectionCard title="Ближайшие визиты" icon={CalendarClock} summary="14 дней">
        {data.appointments.length === 0 ? (
          <p className="text-label text-muted-foreground">Визитов в ближайшие две недели нет.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {data.appointments.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => { const id = byName.get(a.subjectName); if (id) onOpen(id, "appointments"); }} className="flex w-full flex-wrap items-baseline gap-x-2 py-1.5 text-left text-label hover:text-foreground">
                  <span className="font-mono text-2xs tabular-nums text-subtle-foreground">{when(a.at)}</span>
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="text-2xs text-muted-foreground">{a.subjectName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Профилактика" icon={ShieldCheck} summary="просрочено и ближайшие 30 дней">
        {data.preventive.length === 0 ? (
          <p className="text-label text-muted-foreground">Сроков нет.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {data.preventive.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => { const id = byName.get(p.subjectName); if (id) onOpen(id, "preventive"); }} className="flex w-full flex-wrap items-baseline gap-x-2 py-1.5 text-left text-label hover:text-foreground">
                  <span className={`shrink-0 text-2xs ${p.status === "overdue" ? "text-danger" : "text-warning"}`}>{p.status === "overdue" ? "Просрочено" : "Скоро"}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-muted-foreground">· {HEALTH_PREVENTIVE_KIND_LABEL[p.kind]}</span></span>
                  <span className="font-mono text-2xs tabular-nums text-subtle-foreground">{p.nextDueAt ? dayLabel(p.nextDueAt) : ""}</span>
                  <span className="text-2xs text-muted-foreground">{p.subjectName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
