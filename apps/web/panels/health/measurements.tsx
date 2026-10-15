"use client";

import { useCreateHealthMeasurement, useDeleteHealthMeasurement, useHealthMeasurements, useHealthTargets, usePutHealthTarget } from "@orion/core-react";
import {
  HEALTH_MEASUREMENT_KINDS,
  HEALTH_MEASUREMENT_META,
  formatMeasurement,
  healthCanWrite,
  measurementProblem,
  measurementsToCsv,
  rangeState,
  summarizeSeries,
  type HealthMeasurement,
  type HealthMeasurementKind,
  type HealthSubject
} from "@orion/shared-types";
import { Button, EmptyState, Input, SegmentedControl, Select, Skeleton, useToast } from "@orion/ui";
import { Activity, Download, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { SectionCard } from "../home/shared";

/** Без BOM Excel открывает UTF-8 CSV кракозябрами. */
const BOM = String.fromCharCode(0xfeff);
type WindowKey = "30" | "90" | "365" | "all";
const WINDOW_LABEL: Record<WindowKey, string> = { "30": "30 дней", "90": "90 дней", "365": "Год", all: "Всё" };
const when = (iso: string): string => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const num = (n: number | null, decimals = 1): string => (n === null ? "—" : n.toFixed(decimals).replace(".", ","));
const STATE_LABEL = { below: "ниже вашего диапазона", above: "выше вашего диапазона", within: "в вашем диапазоне", unset: "" } as const;

/** Показатели: быстрый ввод, график с личным диапазоном, сводка и CSV для врача. «Норму» ORION не задаёт — только вы. */
export function HealthMeasurements({ workspaceId, subject }: { workspaceId: string | undefined; subject: HealthSubject }): React.ReactElement {
  const { toast } = useToast();
  const canWrite = healthCanWrite(subject.access);
  const [kind, setKind] = useState<HealthMeasurementKind>("weight");
  const [windowKey, setWindowKey] = useState<WindowKey>("90");
  const [adding, setAdding] = useState(false);
  // Окно режется на сервере: до `from` данные даже не приходят.
  const from = windowKey === "all" ? undefined : new Date(Date.now() - Number(windowKey) * 86_400_000).toISOString();
  const { data, isLoading, isError, refetch } = useHealthMeasurements(workspaceId, subject.id, kind, from);
  const { data: targets } = useHealthTargets(workspaceId, subject.id);
  const create = useCreateHealthMeasurement(workspaceId, subject.id);
  const remove = useDeleteHealthMeasurement(workspaceId, subject.id);
  const putTarget = usePutHealthTarget(workspaceId, subject.id);
  const meta = HEALTH_MEASUREMENT_META[kind];
  const target = (targets ?? []).find((t) => t.kind === kind) ?? null;
  const fail = (title: string) => (error: unknown) => toast({ title, description: describeError(error), tone: "danger" });

  function downloadCsv(): void {
    const blob = new Blob([BOM + measurementsToCsv(data ?? [])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${meta.label}-${subject.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const summary = summarizeSeries(data ?? [], target);
  const latestState = summary.latest ? rangeState(summary.latest.value, target) : "unset";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Показатель" className="max-w-[12rem]" value={kind} onChange={(e) => setKind(e.target.value as HealthMeasurementKind)}>
          {HEALTH_MEASUREMENT_KINDS.map((k) => <option key={k} value={k}>{HEALTH_MEASUREMENT_META[k].label}</option>)}
        </Select>
        <SegmentedControl size="sm" aria-label="Период" value={windowKey} onChange={setWindowKey} options={(Object.keys(WINDOW_LABEL) as WindowKey[]).map((k) => ({ value: k, label: WINDOW_LABEL[k] }))} />
        <span className="ml-auto flex gap-2">
          {(data ?? []).length > 0 ? <Button size="sm" variant="subtle" onClick={downloadCsv}><Download className="h-4 w-4" /> CSV для врача</Button> : null}
          {canWrite && !adding ? <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Внести</Button> : null}
        </span>
      </div>

      {adding ? (
        <SectionCard title={`Новая запись · ${meta.label}`} icon={Activity}>
          <MeasurementForm kind={kind} busy={create.isPending} onCancel={() => setAdding(false)} onSubmit={async (values) => {
            try { await create.mutateAsync(values); setAdding(false); } catch (error) { fail("Не удалось сохранить")(error); }
          }} />
        </SectionCard>
      ) : null}

      <SectionCard title={meta.label} icon={Activity} summary={meta.unit}>
        {isLoading ? <Skeleton className="h-40 w-full" /> : isError ? (
          <EmptyState icon={Activity} title="Не удалось загрузить" action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />
        ) : (data ?? []).length === 0 ? (
          <p className="text-label text-muted-foreground">За этот период записей нет.{canWrite ? " Нажмите «Внести» — первая точка уже даст картину." : ""}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div>
                <span className="text-2xl font-semibold tabular-nums">{summary.latest ? formatMeasurement(summary.latest) : "—"}</span>
                <span className="ml-1 text-label text-muted-foreground">{meta.unit}</span>
                {latestState !== "unset" ? <span className={`ml-2 text-2xs ${latestState === "within" ? "text-success" : "text-warning"}`}>{STATE_LABEL[latestState]}</span> : null}
                {summary.latest ? <span className="block text-2xs text-subtle-foreground">{when(summary.latest.measuredAt)}</span> : null}
              </div>
              <dl className="grid grid-cols-4 gap-x-5 text-2xs text-muted-foreground">
                <div><dt>Записей</dt><dd className="text-label text-foreground tabular-nums">{summary.count}</dd></div>
                <div><dt>Мин–макс</dt><dd className="text-label text-foreground tabular-nums">{num(summary.min, meta.decimals)}–{num(summary.max, meta.decimals)}</dd></div>
                <div><dt>Среднее</dt><dd className="text-label text-foreground tabular-nums">{num(summary.average, meta.decimals)}</dd></div>
                <div><dt>Изменение</dt><dd className="text-label text-foreground tabular-nums">{summary.change === null ? "—" : `${summary.change > 0 ? "+" : ""}${num(summary.change, meta.decimals)}`}</dd></div>
              </dl>
            </div>
            <Chart points={data ?? []} kind={kind} target={target} />
            {target && summary.outOfRange > 0 ? <p className="text-2xs text-muted-foreground">Вне вашего диапазона: {summary.outOfRange} из {summary.count}.</p> : null}
          </>
        )}
        {canWrite ? <TargetEditor key={kind + (target ? `${target.min}-${target.max}` : "")} unit={meta.unit} target={target} busy={putTarget.isPending} onSave={(min, max) => putTarget.mutate({ kind, input: { min, max } }, { onError: fail("Не удалось сохранить диапазон") })} /> : target ? <p className="text-2xs text-muted-foreground">Диапазон: {num(target.min, meta.decimals)}–{num(target.max, meta.decimals)} {meta.unit}</p> : null}
      </SectionCard>

      {(data ?? []).length > 0 ? (
        <SectionCard title="Записи" icon={Activity} summary={(data ?? []).length > 15 ? "последние 15" : undefined}>
          <ul className="flex flex-col divide-y divide-border/60">
            {(data ?? []).slice(0, 15).map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-label">
                <span className="w-32 shrink-0 font-mono text-2xs tabular-nums text-subtle-foreground">{when(m.measuredAt)}</span>
                <span className="font-medium tabular-nums">{formatMeasurement(m)} <span className="font-normal text-muted-foreground">{meta.unit}</span></span>
                {m.context ? <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{m.context}</span> : <span className="flex-1" />}
                {canWrite ? <Button size="sm" variant="subtle" aria-label="Удалить запись" onClick={() => remove.mutate(m.id, { onError: fail("Не удалось удалить") })}><Trash2 className="h-4 w-4" /></Button> : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}

/** Линейный график без библиотек: ось времени, личный диапазон полосой, давление — две линии. Точки подписаны в списке ниже. */
function Chart({ points, kind, target }: { points: HealthMeasurement[]; kind: HealthMeasurementKind; target: { min: number | null; max: number | null } | null }): React.ReactElement {
  const sorted = [...points].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const W = 640;
  const H = 180;
  const pad = { l: 40, r: 12, t: 10, b: 22 };
  const ys = sorted.flatMap((p) => [p.value, ...(p.value2 !== null ? [p.value2] : [])]);
  if (target?.min != null) ys.push(target.min);
  if (target?.max != null) ys.push(target.max);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const margin = (hi - lo) * 0.1;
  lo -= margin; hi += margin;
  const t0 = new Date(sorted[0].measuredAt).getTime();
  const t1 = new Date(sorted[sorted.length - 1].measuredAt).getTime();
  const x = (iso: string): number => pad.l + (t1 === t0 ? (W - pad.l - pad.r) / 2 : ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r));
  const y = (v: number): number => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (pick: (p: HealthMeasurement) => number | null): string => sorted.flatMap((p) => { const v = pick(p); return v === null ? [] : [`${x(p.measuredAt).toFixed(1)},${y(v).toFixed(1)}`]; }).join(" ");
  const ticks = [lo + margin, (lo + hi) / 2, hi - margin];
  const decimals = HEALTH_MEASUREMENT_META[kind].decimals;
  const dayFmt = (ms: number): string => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={`График: ${sorted.length} записей с ${dayFmt(t0)} по ${dayFmt(t1)}`}>
      {target && (target.min !== null || target.max !== null) ? (
        <rect x={pad.l} width={W - pad.l - pad.r} y={y(target.max ?? hi)} height={Math.max(0, y(target.min ?? lo) - y(target.max ?? hi))} fill="currentColor" className="text-success/10" />
      ) : null}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-border" strokeDasharray="3 4" />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-current text-subtle-foreground" fontSize="10">{v.toFixed(decimals).replace(".", ",")}</text>
        </g>
      ))}
      <polyline points={line((p) => p.value)} fill="none" stroke="#6aa7ff" strokeWidth="2" strokeLinejoin="round" />
      {kind === "blood_pressure" ? <polyline points={line((p) => p.value2)} fill="none" stroke="#f2a65a" strokeWidth="2" strokeLinejoin="round" /> : null}
      {sorted.map((p) => <circle key={p.id} cx={x(p.measuredAt)} cy={y(p.value)} r="3" fill="#6aa7ff"><title>{`${when(p.measuredAt)}: ${formatMeasurement(p)}`}</title></circle>)}
      <text x={pad.l} y={H - 5} className="fill-current text-subtle-foreground" fontSize="10">{dayFmt(t0)}</text>
      <text x={W - pad.r} y={H - 5} textAnchor="end" className="fill-current text-subtle-foreground" fontSize="10">{dayFmt(t1)}</text>
      {kind === "blood_pressure" ? <text x={W - pad.r} y={pad.t + 8} textAnchor="end" className="fill-current text-muted-foreground" fontSize="10">синяя — верхнее, оранжевая — нижнее</text> : null}
    </svg>
  );
}

function TargetEditor({ unit, target, busy, onSave }: { unit: string; target: { min: number | null; max: number | null } | null; busy: boolean; onSave: (min: number | null, max: number | null) => void }): React.ReactElement {
  const [min, setMin] = useState(target?.min?.toString() ?? "");
  const [max, setMax] = useState(target?.max?.toString() ?? "");
  const parse = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const lo = parse(min);
  const hi = parse(max);
  const invalid = (lo !== null && !Number.isFinite(lo)) || (hi !== null && !Number.isFinite(hi)) || (lo !== null && hi !== null && lo > hi);
  const dirty = (lo ?? null) !== (target?.min ?? null) || (hi ?? null) !== (target?.max ?? null);
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/60 pt-3" onSubmit={(e) => { e.preventDefault(); if (!invalid) onSave(lo, hi); }}>
      <span className="text-2xs text-muted-foreground">Мой диапазон ({unit}; для давления — верхнее значение):</span>
      <Input className="w-24" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="от" aria-label="Нижняя граница" />
      <Input className="w-24" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="до" aria-label="Верхняя граница" />
      <Button type="submit" size="sm" variant="ghost" disabled={busy || invalid || !dirty}>Сохранить</Button>
      {invalid ? <span className="text-2xs text-danger">Проверьте границы</span> : null}
    </form>
  );
}

function MeasurementForm({ kind, busy, onSubmit, onCancel }: {
  kind: HealthMeasurementKind;
  busy: boolean;
  onSubmit: (values: { kind: HealthMeasurementKind; value: number; value2: number | null; measuredAt?: string; context: string; note: string }) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const meta = HEALTH_MEASUREMENT_META[kind];
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [at, setAt] = useState("");
  const [context, setContext] = useState("");
  const num2 = (v: string): number => Number(v.replace(",", "."));
  const parsed = value.trim() === "" ? NaN : num2(value);
  const parsed2 = kind === "blood_pressure" ? (value2.trim() === "" ? NaN : num2(value2)) : null;
  // Тот же текст ошибки, что вернёт сервер, — до отправки.
  const problem = Number.isNaN(parsed) || (kind === "blood_pressure" && Number.isNaN(parsed2 as number)) ? null : measurementProblem(kind, parsed, parsed2);
  const ready = !Number.isNaN(parsed) && (kind !== "blood_pressure" || !Number.isNaN(parsed2 as number)) && !problem;
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (ready) void onSubmit({ kind, value: parsed, value2: parsed2, measuredAt: at ? new Date(at).toISOString() : undefined, context: context.trim(), note: "" });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-32" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "blood_pressure" ? "верхнее" : meta.unit} aria-label="Значение" autoFocus />
        {kind === "blood_pressure" ? <><span aria-hidden>/</span><Input className="w-32" inputMode="decimal" value={value2} onChange={(e) => setValue2(e.target.value)} placeholder="нижнее" aria-label="Нижнее значение" /></> : null}
        <span className="text-label text-muted-foreground">{meta.unit}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Когда (пусто — сейчас)<Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Условия (необязательно)<Input value={context} onChange={(e) => setContext(e.target.value)} placeholder="натощак, после нагрузки" maxLength={120} /></label>
      </div>
      {problem ? <p className="text-2xs text-danger">{problem}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="subtle" onClick={onCancel}>Отмена</Button>
        <Button type="submit" size="sm" disabled={busy || !ready}>Сохранить</Button>
      </div>
    </form>
  );
}
