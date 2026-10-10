"""Разбор рыночных событий по композиту площадок: что происходило вокруг.

Событие ищется по композиту — медиане закрытий площадок на общей метке времени:
сбой или всплеск одной биржи медиану не двигает, поэтому «движение рынка» — это
то, что подтвердило большинство площадок, а расхождение источников видно
отдельным событием: медиана стоит, а дисперсия растёт.

Порог события робастный: доля от медианного шага этого же окна плюс пол —
спокойный рынок не рождает событий из шума. Событие — прошлое: окно показывает,
что было вокруг, и не выдаётся за сигнал или прогноз.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from statistics import median

from compass.models import Candle

EVENT_MOVE_MULT = 4.0  # движение: k × медианы |шагов| окна, не меньше пола
EVENT_MOVE_MIN_PCT = 0.3  # пол движения: тихий рынок не превращается в события
EVENT_DISPERSION_MULT = 3.0  # разлад площадок: та же логика для дисперсии
EVENT_DISPERSION_MIN_PCT = 0.2
MAX_EVENTS = 10  # показываем сильнейшие; остальные — не молча, а через порог и счёт
MIN_COMPOSITE_VENUES = 2  # одна площадка — её цена, а не рынок
MIN_BARS = 50  # меньше строк композита — медиана шага шумная: пороги менее честны


def composite_rows(series: dict[str, Sequence[Candle]], tf_ms: int) -> list[dict]:
    """Ряд композита по объединению меток: цена — медиана живых закрытий.

    Метка попадает в ряд, только если цену дали не меньше MIN_COMPOSITE_VENUES
    площадок. Битое закрытие (≤ 0) — как отсутствие котировки, а не как цена.
    Движение считается только через шаг tf_ms: разрыв ряда не выдаётся за шаг.
    """
    by_ts: dict[int, dict[str, float]] = defaultdict(dict)
    vol: dict[int, float] = defaultdict(float)
    for venue, candles in series.items():
        for c in candles:
            if c.close > 0:
                by_ts[c.ts][venue] = c.close
                vol[c.ts] += max(0.0, c.volume)
    out: list[dict] = []
    prev_ts: int | None = None
    prev_price: float | None = None
    for ts in sorted(by_ts):
        prices = by_ts[ts]
        if len(prices) < MIN_COMPOSITE_VENUES:
            continue
        vals = list(prices.values())
        price = float(median(vals))
        disp = (max(vals) - min(vals)) / price * 100
        move: float | None = None
        step_ok = prev_ts is not None and ts - prev_ts == tf_ms
        if step_ok and prev_price is not None and prev_price > 0:
            move = (price - prev_price) / prev_price * 100
        out.append(
            {
                "ts": ts,
                "price": price,
                "venues": len(prices),
                "dispersion_pct": round(disp, 4),
                "move_pct": None if move is None else round(move, 4),
                "volume": vol[ts],
                "prices": dict(prices),
            }
        )
        prev_ts, prev_price = ts, price
    return out


def detect_events(rows: Sequence[dict]) -> dict:
    """События по ряду композита: движения и разлад площадок.

    Порог — максимум из «k × медианы» и пола; медиана окна сама почти не
    сдвигается редкими всплесками. Соседние свечи одного вида схлопываются в
    одно событие, лицо которого — сильнейшая свеча. Сила — превышение порога:
    события движений и разлада сравнимы между собой, и верхушка берётся по ней.
    """
    moves = [abs(r["move_pct"]) for r in rows if r["move_pct"] is not None]
    disps = [r["dispersion_pct"] for r in rows]
    move_th = max(EVENT_MOVE_MULT * median(moves), EVENT_MOVE_MIN_PCT) if moves else EVENT_MOVE_MIN_PCT
    disp_th = (
        max(EVENT_DISPERSION_MULT * median(disps), EVENT_DISPERSION_MIN_PCT)
        if disps
        else EVENT_DISPERSION_MIN_PCT
    )
    move_flags = [r["move_pct"] is not None and abs(r["move_pct"]) >= move_th for r in rows]
    disp_flags = [r["dispersion_pct"] >= disp_th for r in rows]
    events = _collapse(rows, move_flags, "move", move_th)
    events += _collapse(rows, disp_flags, "dispersion", disp_th)
    events.sort(key=lambda e: e["strength"], reverse=True)
    events = events[:MAX_EVENTS]
    events.sort(key=lambda e: e["ts"])
    return {"events": events, "move_threshold_pct": move_th, "dispersion_threshold_pct": disp_th}


def _measure(row: dict, kind: str) -> float:
    if kind == "move":
        return abs(row["move_pct"] or 0.0)
    return row["dispersion_pct"]


def _collapse(rows: Sequence[dict], flags: Sequence[bool], kind: str, threshold: float) -> list[dict]:
    """Серии соседних помеченных свечей — по одному событию, лицом сильнейшая."""
    out: list[dict] = []
    start: int | None = None
    for i, flag in enumerate(flags):
        if flag and start is None:
            start = i
        if start is not None and (not flag or i == len(flags) - 1):
            end = i - 1 if not flag else i
            best = max(range(start, end + 1), key=lambda j: _measure(rows[j], kind))
            r = rows[best]
            out.append(
                {
                    "kind": kind,
                    "ts": r["ts"],
                    "start_ts": rows[start]["ts"],
                    "end_ts": rows[end]["ts"],
                    "bars": end - start + 1,
                    "move_pct": r["move_pct"],
                    "dispersion_pct": r["dispersion_pct"],
                    "price": r["price"],
                    "venues": r["venues"],
                    "strength": round(_measure(r, kind) / threshold, 2),
                }
            )
            start = None
    return out


def with_windows(
    rows: Sequence[dict], events: Sequence[dict], window: int, tf_ms: int
) -> list[dict]:
    """Копия событий с окном свечей вокруг: [ts − window·tf, ts + window·tf].

    Окно обрезается о края ряда честно: строк меньше — значит, истории вокруг
    события меньше, и ничего не дорисовывается.
    """
    out: list[dict] = []
    for e in events:
        lo, hi = e["ts"] - window * tf_ms, e["ts"] + window * tf_ms
        out.append({**e, "window_bars": [r for r in rows if lo <= r["ts"] <= hi]})
    return out
