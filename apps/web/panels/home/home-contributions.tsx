"use client";

import { useHomeContributions } from "@orion/core-react";
import { CONTRIBUTION_PERIODS, CONTRIBUTION_PERIOD_LABEL, formatDuration, type ContributionPeriod, type HomeContributions } from "@orion/shared-types";
import { Button, EmptyState, SegmentedControl, Skeleton } from "@orion/ui";
import { Scale } from "lucide-react";
import { useState } from "react";
import { SectionCard } from "./shared";

type Mode = "count" | "time";

/** Цвета участников: подпись и число всегда рядом, цвет только помогает различать. */
const PALETTE = ["#6aa7ff", "#f2a65a", "#7fd1a1", "#c58af9", "#f27c9b", "#5fd0d8"];
const UNKNOWN_COLOR = "#7b8494";

const percent = (share: number): string => `${Math.round(share * 100)}%`;
const weekLabel = (start: string): string => new Date(`${start}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * «Вклад»: кто сколько закрыл дел дома. Это зеркало, а не рейтинг — без мест и баллов. Все числа
 * приходят от сервера (`GET homes/contributions`); «сделал» — тот, кто закрыл дело, а не тот, кому оно
 * назначено, поэтому «взял чужое» показано отдельно. `homeId` не задан — по всем объектам.
 */
export function HomeContributions({ workspaceId, homeId, title = "Кто что делает" }: { workspaceId: string | undefined; homeId?: string; title?: string }): React.ReactElement {
  const [period, setPeriod] = useState<ContributionPeriod>("month");
  const [mode, setMode] = useState<Mode>("count");
  const { data, isLoading, isError, refetch } = useHomeContributions(workspaceId, period, homeId);

  return (
    <SectionCard title={title} icon={Scale} summary={data ? `закрыто: ${data.totalDone}` : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          aria-label="Период"
          value={period}
          onChange={setPeriod}
          options={CONTRIBUTION_PERIODS.map((p) => ({ value: p, label: CONTRIBUTION_PERIOD_LABEL[p] }))}
        />
        <SegmentedControl
          size="sm"
          aria-label="Что считать"
          value={mode}
          onChange={setMode}
          options={[
            { value: "count", label: "Дела" },
            { value: "time", label: "Время" }
          ]}
        />
      </div>
      {isError ? (
        <EmptyState icon={Scale} title="Не удалось посчитать" description="Проверьте соединение и попробуйте ещё раз." action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />
      ) : isLoading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <ContributionsBody data={data} mode={mode} />
      )}
    </SectionCard>
  );
}

function ContributionsBody({ data, mode }: { data: HomeContributions; mode: Mode }): React.ReactElement {
  const timeMode = mode === "time";
  const colorOf = new Map(data.members.map((m, i) => [m.userId, PALETTE[i % PALETTE.length]]));
  const valueOf = (m: HomeContributions["members"][number]): number => (timeMode ? m.minutes : m.done);
  const shareOf = (m: HomeContributions["members"][number]): number => (timeMode ? m.minutesShare : m.share);
  const total = timeMode ? data.totalMinutes : data.totalDone;

  if (timeMode && data.totalMinutes === 0) {
    return <p className="text-label text-muted-foreground">Время по делам не ведётся: задайте оценку дела или запустите таймер — тогда здесь появится соотношение по времени.</p>;
  }
  if (!timeMode && data.totalDone === 0) {
    return <p className="text-label text-muted-foreground">За этот период ещё нет закрытых дел дома. Закройте дело — оно появится здесь.</p>;
  }

  const segments = data.members.filter((m) => valueOf(m) > 0);
  const undeterminedShare = !timeMode && data.totalDone > 0 ? data.undetermined / data.totalDone : 0;

  return (
    <div className="space-y-4">
      <div
        role="img"
        aria-label={`Соотношение: ${segments.map((m) => `${m.name} ${percent(shareOf(m))}`).join(", ")}${undeterminedShare > 0 ? `, не определено ${percent(undeterminedShare)}` : ""}`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-white/5"
      >
        {segments.map((m) => (
          <div key={m.userId} style={{ width: `${shareOf(m) * 100}%`, background: colorOf.get(m.userId) }} />
        ))}
        {undeterminedShare > 0 ? <div style={{ width: `${undeterminedShare * 100}%`, background: UNKNOWN_COLOR, opacity: 0.5 }} /> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-label">
          <thead className="text-2xs text-subtle-foreground">
            <tr>
              <th className="py-1 pr-2 font-normal">Участник</th>
              <th className="px-2 py-1 text-right font-normal">{timeMode ? "Время" : "Закрыл"}</th>
              <th className="px-2 py-1 text-right font-normal">Доля</th>
              <th className="px-2 py-1 text-right font-normal" title="Закрыл дело, назначенное другому">Взял чужое</th>
              <th className="px-2 py-1 text-right font-normal">Открыто</th>
              <th className="py-1 pl-2 text-right font-normal">Просрочено</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.members.map((m) => (
              <tr key={m.userId}>
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf.get(m.userId) }} />
                    {m.name}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{timeMode ? formatDuration(m.minutes) : m.done}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{total > 0 ? percent(shareOf(m)) : "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{m.takenOver || "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{m.openAssigned || "—"}</td>
                <td className={`py-1.5 pl-2 text-right tabular-nums ${m.overdue ? "text-danger" : "text-muted-foreground"}`}>{m.overdue || "—"}</td>
              </tr>
            ))}
            {data.undetermined > 0 ? (
              <tr className="text-muted-foreground">
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: UNKNOWN_COLOR, opacity: 0.5 }} />
                    Не определено
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{timeMode ? "—" : data.undetermined}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{!timeMode ? percent(undeterminedShare) : "—"}</td>
                <td colSpan={3} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {!timeMode ? <Weeks data={data} colorOf={colorOf} /> : null}

      <p className="text-2xs text-subtle-foreground">
        «Закрыл» — тот, кто перевёл дело в «Готово»; закрытые до появления журнала, агентом ИИ или вышедшим участником попадают в «Не определено».
        {data.openUnassigned > 0 ? ` Ничьих открытых дел: ${data.openUnassigned}.` : ""}
        {timeMode ? " Время — фактическое по таймеру, а если его нет — оценка дела; дела без того и другого в этом режиме не учтены." : ""}
      </p>
    </div>
  );
}

/** Доли по неделям: видно, ровно ли распределено или перекос копится. */
function Weeks({ data, colorOf }: { data: HomeContributions; colorOf: Map<string, string> }): React.ReactElement | null {
  const rows = data.weeks.map((w) => ({ ...w, total: Object.values(w.counts).reduce((s, n) => s + n, 0) + w.undetermined }));
  const peak = Math.max(1, ...rows.map((w) => w.total));
  if (rows.length < 2) return null;
  return (
    <div>
      <p className="mb-1 text-2xs text-subtle-foreground">По неделям</p>
      <ul className="flex h-20 items-end gap-1.5" aria-label="Закрытые дела по неделям">
        {rows.map((w) => (
          <li key={w.start} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`Неделя с ${weekLabel(w.start)}: ${w.total}`}>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${(w.total / peak) * 100}%` }}>
              {data.members.map((m) => (w.counts[m.userId] ? <div key={m.userId} style={{ flexGrow: w.counts[m.userId], background: colorOf.get(m.userId) }} /> : null))}
              {w.undetermined > 0 ? <div style={{ flexGrow: w.undetermined, background: UNKNOWN_COLOR, opacity: 0.5 }} /> : null}
            </div>
            <span className="mt-1 truncate text-center text-2xs tabular-nums text-subtle-foreground">{weekLabel(w.start)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
