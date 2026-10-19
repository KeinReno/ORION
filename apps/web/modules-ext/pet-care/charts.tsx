"use client";

import { PET_DAY_STATUSES, PET_DAY_STATUS_META, type PetStats } from "@orion/shared-types";
import { formatPetDayShort } from "../../lib/pet-care-days";

/** Простые графики на SVG/div: новых UI-библиотек в ORION не добавляем (CLAUDE.md). */

const W = 560;
const H = 180;
const PAD = { left: 44, right: 12, top: 12, bottom: 24 };

export function WeightChart({ points }: { points: Array<{ day: string; weight: number }> }): React.ReactElement {
  const values = points.map((point) => point.weight);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // Плоская линия (все веса равны) растягиваем на ±0,1 кг, чтобы не делить на ноль.
  const min = high === low ? low - 0.1 : low - (high - low) * 0.1;
  const max = high === low ? high + 0.1 : high + (high - low) * 0.1;
  const x = (index: number): number => PAD.left + (points.length === 1 ? 0.5 : index / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (value: number): number => PAD.top + (1 - (value - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.weight).toFixed(1)}`).join(" ");
  const ticks = [max, (max + min) / 2, min];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Динамика веса: ${points[0]!.weight} → ${points[points.length - 1]!.weight} кг`}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="3 3" />
          <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6}>
            {tick.toFixed(1)}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent, #6366f1)" strokeWidth={2} strokeLinejoin="round" />
      {points.map((point, index) => (
        <circle key={point.day} cx={x(index)} cy={y(point.weight)} r={3} fill="var(--accent, #6366f1)">
          <title>{`${formatPetDayShort(point.day)}: ${point.weight} кг`}</title>
        </circle>
      ))}
      <text x={PAD.left} y={H - 6} fontSize={10} fill="currentColor" fillOpacity={0.6}>
        {formatPetDayShort(points[0]!.day)}
      </text>
      <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6}>
        {formatPetDayShort(points[points.length - 1]!.day)}
      </text>
    </svg>
  );
}

export function SymptomBars({ items }: { items: PetStats["symptomFreq"] }): React.ReactElement {
  const top = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className="space-y-1.5" aria-label="Частота симптомов">
      {items.map((item) => (
        <li key={item.id} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-2 text-xs">
          <span className="truncate">{item.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-secondary">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(item.count / top) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatusDistribution({ stats }: { stats: PetStats }): React.ReactElement {
  return (
    <ul className="space-y-1.5" aria-label="Распределение по состоянию">
      {PET_DAY_STATUSES.map((status) => {
        const count = stats.byStatus[status];
        const percent = stats.loggedDays > 0 ? Math.round((count / stats.loggedDays) * 100) : 0;
        return (
          <li key={status} className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-2 text-xs">
            <span>{PET_DAY_STATUS_META[status].label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-secondary">
              <span className="block h-full rounded-full" style={{ width: `${percent}%`, background: PET_DAY_STATUS_META[status].color }} />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {count} · {percent}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}
