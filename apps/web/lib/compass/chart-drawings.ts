/** Геометрия рисунков на графике (IMPROVEMENT_SPEC §7). */

import type { Candle, ChartDrawingDto, DrawingKind, DrawingPoint } from "./types";

export type DrawTool = "cursor" | "ruler" | "hline" | "vline" | "trend" | "ray" | "arrow" | "fib" | "channel" | "rect" | "text" | "trade";

/** Инструменты, которым хватает одного клика. */
export const ONE_CLICK_TOOLS: DrawTool[] = ["hline", "vline", "text"];

/** Уровни Фибоначчи: доля хода от первой точки ко второй. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const DRAW_TOOL_LABEL: Record<DrawTool, string> = {
  cursor: "Курсор",
  ruler: "Линейка",
  hline: "Уровень",
  vline: "Вертикаль",
  trend: "Тренд",
  ray: "Луч",
  arrow: "Стрелка",
  fib: "Фибоначчи",
  channel: "Канал",
  rect: "Зона",
  text: "Текст",
  trade: "Сделка",
};

export const HIT_PX = 8;

export interface ChartCoords {
  priceToY: (price: number) => number | null;
  yToPrice: (y: number) => number | null;
  timeToX: (tMs: number) => number | null;
  xToTime: (x: number) => number | null;
  width: number;
  height: number;
}

export function visibleDrawings(drawings: ChartDrawingDto[], tf: string): ChartDrawingDto[] {
  return drawings.filter((d) => !d.visible_tfs || d.visible_tfs.includes(tf));
}

export function snapPoint(x: number, y: number, coords: ChartCoords, candles: Candle[], magnet = false): DrawingPoint {
  const t = coords.xToTime(x);
  const price = coords.yToPrice(y);
  if (t == null || price == null || !Number.isFinite(price) || price <= 0) {
    return { t: 0, price: 1 };
  }
  let ts = t;
  if (candles.length) {
    let best = candles[0].t;
    let bestDist = Math.abs(candles[0].t - ts);
    for (const c of candles) {
      const dist = Math.abs(c.t - ts);
      if (dist < bestDist) {
        bestDist = dist;
        best = c.t;
      }
    }
    ts = best;
    if (magnet) {
      // магнит: цена прилипает к ближайшей из цен свечи (O, H, L, C), если она в пределах ~20 пикселей
      const bar = candles.find((c) => c.t === best);
      if (bar) {
        let near = price;
        let nearPx = 20;
        for (const v of [bar.o, bar.h, bar.l, bar.c]) {
          const vy = coords.priceToY(v);
          if (vy != null && Math.abs(vy - y) < nearPx) {
            nearPx = Math.abs(vy - y);
            near = v;
          }
        }
        return { t: ts, price: near };
      }
    }
  }
  return { t: ts, price };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointXY(p: DrawingPoint, coords: ChartCoords): { x: number; y: number } | null {
  const x = coords.timeToX(p.t);
  const y = coords.priceToY(p.price);
  if (x == null || y == null) return null;
  return { x, y };
}

export function hitTestDrawing(
  d: ChartDrawingDto,
  x: number,
  y: number,
  coords: ChartCoords,
): "body" | "p0" | "p1" | "p2" | null {
  if (d.kind === "hline") {
    const py = coords.priceToY(d.points[0].price);
    if (py == null) return null;
    return Math.abs(py - y) <= HIT_PX ? "body" : null;
  }
  if (d.kind === "vline") {
    const px = coords.timeToX(d.points[0].t);
    if (px == null) return null;
    return Math.abs(px - x) <= HIT_PX ? "body" : null;
  }
  if (d.kind === "text") {
    const q = pointXY(d.points[0], coords);
    if (!q) return null;
    const w = Math.max(24, (d.label.length || 1) * 7 + 12);
    return x >= q.x - 4 && x <= q.x + w && y >= q.y - 16 && y <= q.y + 6 ? "body" : null;
  }
  const a = pointXY(d.points[0], coords);
  const b = pointXY(d.points[1], coords);
  if (!a || !b) return null;
  if (d.kind === "channel" && d.points[2]) {
    const c = pointXY(d.points[2], coords);
    if (!c) return null;
    if (dist({ x, y }, c) <= HIT_PX) return "p2";
    const off = channelOffsetY(a, b, c);
    if (dist({ x, y }, a) <= HIT_PX) return "p0";
    if (dist({ x, y }, b) <= HIT_PX) return "p1";
    const shift = { x: 0, y: off };
    if (distToSegment({ x, y }, a, b) <= HIT_PX) return "body";
    if (distToSegment({ x, y }, { x: a.x, y: a.y + shift.y }, { x: b.x, y: b.y + shift.y }) <= HIT_PX) return "body";
    return null;
  }
  if (dist({ x, y }, a) <= HIT_PX) return "p0";
  if (dist({ x, y }, b) <= HIT_PX) return "p1";
  if (d.kind === "rect") {
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    const inside = x >= left && x <= right && y >= top && y <= bottom;
    const nearEdge =
      Math.abs(x - left) <= HIT_PX || Math.abs(x - right) <= HIT_PX
      || Math.abs(y - top) <= HIT_PX || Math.abs(y - bottom) <= HIT_PX;
    return inside || nearEdge ? "body" : null;
  }
  if (d.kind === "fib") {
    const left = Math.min(a.x, b.x) - HIT_PX;
    const right = Math.max(a.x, b.x) + HIT_PX;
    if (x < left || x > right) return null;
    for (const lvl of FIB_LEVELS) {
      const ly = coords.priceToY(d.points[0].price + (d.points[1].price - d.points[0].price) * lvl);
      if (ly != null && Math.abs(ly - y) <= HIT_PX) return "body";
    }
    return null;
  }
  if (d.kind === "ray") {
    // луч уходит за вторую точку до правого края
    const dx = b.x - a.x;
    const far = dx === 0 ? b : { x: coords.width + 200, y: a.y + ((b.y - a.y) / dx) * (coords.width + 200 - a.x) };
    return distToSegment({ x, y }, a, dx >= 0 ? far : b) <= HIT_PX ? "body" : null;
  }
  if (distToSegment({ x, y }, a, b) <= HIT_PX) return "body";
  return null;
}

/** Сдвиг параллельной линии канала по вертикали (в пикселях): расстояние от точки c до линии a–b по y. */
export function channelOffsetY(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const lineY = dx === 0 ? a.y : a.y + ((b.y - a.y) / dx) * (c.x - a.x);
  return c.y - lineY;
}

export function findDrawingAt(
  drawings: ChartDrawingDto[],
  x: number,
  y: number,
  coords: ChartCoords,
): ChartDrawingDto | null {
  for (let i = drawings.length - 1; i >= 0; i--) {
    if (hitTestDrawing(drawings[i], x, y, coords)) return drawings[i];
  }
  return null;
}

export function rectBounds(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function rulerStats(a: DrawingPoint, b: DrawingPoint): { dp: number; dt: number; pct: number } {
  const dp = b.price - a.price;
  const dt = b.t - a.t;
  const pct = a.price > 0 ? (dp / a.price) * 100 : 0;
  return { dp, dt, pct };
}

export function drawingColor(kind: DrawingKind): string {
  if (kind === "hline" || kind === "vline") return "var(--warn)";
  if (kind === "fib" || kind === "channel") return "var(--accent)";
  if (kind === "text") return "var(--text)";
  if (kind === "rect") return "var(--accent)";
  if (kind === "ruler") return "var(--muted)";
  return "var(--text)";
}
