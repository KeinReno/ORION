"""Lead/lag площадок: кто повторяет движение раньше — по общим закрытым свечам.

Статистика — сдвинутая корреляция доходностей: площадка «ведёт», если её ход
на баре i лучше всего повторяется у другой площадки через k ≥ 1 баров, сдвиг
значим по t-статистике и по модулю сильнее нулевого (иначе площадки просто
движутся вместе). Лидер не назначается заранее: при слабом сдвиге — честное
«устойчивого лидерства нет», а не лучший из посредственных. Сдвиг — ассоциация,
а не причинность: публикация свечей у бирж асинхронна, мнимый сдвиг в один бар
возможен без реального лидерства.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence

from compass.models import Candle

MAX_LAG = 5  # сдвиг ищем до 5 баров в обе стороны
MIN_BARS = 120  # меньше общих закрытых свечей у пары — пару не считаем
PART_MIN_BARS = 30  # треть или половина окна короче — срез пропускаем
T_MIN = 2.0  # порог |t| корреляции (≈5% двусторонне)
LEAD_SHARE_MIN = 0.6  # доля решённых пар, чтобы претендовать на лидерство
STABLE_THIRDS_MIN = 2  # в скольких третях окна площадка должна вести
MIN_LEAD_VOTES = 2  # меньше двух выигранных пар — лидером не называем


def _returns(closes: Sequence[float]) -> list[float]:
    """Доходности соседних закрытий. Битое закрытие (≤ 0) — пусто: не сдвигаем молча."""
    out: list[float] = []
    for i in range(1, len(closes)):
        if closes[i - 1] <= 0 or closes[i] <= 0:
            return []
        out.append(closes[i] / closes[i - 1] - 1)
    return out


def _pearson(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Корреляция Пирсона. Постоянный ряд — None, а не выдуманный ноль."""
    if len(xs) < 3 or len(xs) != len(ys):
        return None
    try:
        r = statistics.correlation(xs, ys)
    except statistics.StatisticsError:
        return None
    return r if math.isfinite(r) else None


def _t_stat(r: float, n: int) -> float | None:
    """t-статистика корреляции: r·√((n−2)/(1−r²)). Идеальная — бесконечность."""
    if n < 4:
        return None
    if abs(r) >= 1:
        return math.inf if r > 0 else -math.inf
    return r * math.sqrt((n - 2) / (1 - r * r))


def pair_lead(a: Sequence[float], b: Sequence[float], max_lag: int = MAX_LAG) -> dict:
    """Решение пары по сдвинутым корреляциям доходностей.

    Сдвиг k > 0 — ход `a` повторяется у `b` через k баров (ведёт a), k < 0 —
    наоборот. Решение есть, только если лучший ненулевой сдвиг значим
    (|t| ≥ T_MIN) и по модулю сильнее нулевого: иначе площадки движутся
    вместе, и вести никого не назначаем. Совсем короткий срез — тоже
    без решения.
    """
    out: dict = {
        "leader": None,
        "lag_bars": None,
        "corr": None,
        "t_stat": None,
        "zero_lag_corr": None,
    }
    if len(a) < PART_MIN_BARS or len(a) != len(b):
        return out
    zero = _pearson(a, b)
    out["zero_lag_corr"] = None if zero is None else round(zero, 4)
    best: tuple[int, float, int] | None = None  # (сдвиг, корреляция, наблюдений)
    for k in range(1, max_lag + 1):
        for sign in (1, -1):
            xs = a[: len(a) - k] if sign > 0 else a[k:]
            ys = b[k:] if sign > 0 else b[: len(b) - k]
            r = _pearson(xs, ys)
            if r is not None and (best is None or abs(r) > abs(best[1])):
                best = (sign * k, r, len(xs))
    if best is None:
        return out
    k, r, n = best
    t = _t_stat(r, n)
    out["corr"] = round(r, 4)
    if t is not None and math.isfinite(t):
        out["t_stat"] = round(t, 2)
    significant = t is not None and abs(t) >= T_MIN
    stronger = zero is None or abs(r) > abs(zero)
    if significant and stronger:
        out["leader"] = "a" if k > 0 else "b"
        out["lag_bars"] = abs(k)
    return out


def wilson_interval(votes: int, decided: int, z: float = 1.96) -> tuple[float, float] | None:
    """Доверительный интервал доли (Wilson, 95%): даже 5 из 5 — не «ровно 1,0»."""
    if decided <= 0:
        return None
    p = votes / decided
    denom = 1 + z * z / decided
    center = (p + z * z / (2 * decided)) / denom
    half = z * math.sqrt(p * (1 - p) / decided + z * z / (4 * decided * decided)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def _bounds(n: int, parts: int) -> list[tuple[int, int]]:
    edges = [round(i * n / parts) for i in range(parts + 1)]
    return [(edges[i], edges[i + 1]) for i in range(parts)]


def _slim(seg: dict | None) -> dict | None:
    return None if seg is None else {"leader": seg["leader"], "lag_bars": seg["lag_bars"]}


def _segment_leaders(
    ra: Sequence[float], rb: Sequence[float], max_lag: int, parts: int
) -> list[dict | None]:
    """Решения пары по кускам окна: короткий кусок — пропуск, а не догадка."""
    out: list[dict | None] = []
    for lo, hi in _bounds(len(ra), parts):
        out.append(None if hi - lo < PART_MIN_BARS else _slim(pair_lead(ra[lo:hi], rb[lo:hi], max_lag)))
    return out


def _halves(ra: Sequence[float], rb: Sequence[float], max_lag: int) -> dict:
    """Половины окна и какая из них волатильнее — по медианному |ходу| пары."""
    bounds = _bounds(len(ra), 2)
    segs = _segment_leaders(ra, rb, max_lag, 2)
    moves: list[float | None] = []
    for lo, hi in bounds:
        chunk = sorted(abs(x) + abs(y) for x, y in zip(ra[lo:hi], rb[lo:hi]))
        moves.append(None if not chunk else chunk[len(chunk) // 2] / 2)
    first = moves[0] if moves[0] is not None else -1.0
    second = moves[1] if moves[1] is not None else -1.0
    return {
        "volatile_half": "first" if first >= second else "second",
        "first": segs[0],
        "second": segs[1],
        "first_median_move_pct": None if moves[0] is None else round(moves[0] * 100, 4),
        "second_median_move_pct": None if moves[1] is None else round(moves[1] * 100, 4),
    }


def _empty_halves() -> dict:
    return {
        "volatile_half": "first",
        "first": None,
        "second": None,
        "first_median_move_pct": None,
        "second_median_move_pct": None,
    }


def analyze(
    series: dict[str, Sequence[Candle]], max_lag: int = MAX_LAG, min_bars: int = MIN_BARS
) -> dict:
    """Разбор пара-за-парой: решения, частоты площадок, устойчивость, режимы.

    Каждая пара считается по своему пересечению закрытых свечей: биржа с
    пропусками не режет выборку остальным. Площадка ведёт в паре, только
    когда сдвиг значим; устойчивым лидером называется, если вела не меньше
    MIN_LEAD_VOTES пар, её доля ≥ LEAD_SHARE_MIN и она ведёт в не менее чем
    STABLE_THIRDS_MIN третях окна. Несколько претендентов — `contested`;
    никто не набрал — `no_stable_leadership`; окно короче минимума —
    `insufficient_data`. Лидер — результат процедуры на этом окне, а не
    назначенная биржа.
    """
    books = {x: {c.ts: c.close for c in cs} for x, cs in series.items() if cs}
    venues = sorted(books)
    pairs: list[dict] = []
    for i, a in enumerate(venues):
        for b in venues[i + 1 :]:
            common = sorted(books[a].keys() & books[b].keys())
            long_enough = len(common) >= min_bars
            ra = _returns([books[a][t] for t in common]) if long_enough else []
            rb = _returns([books[b][t] for t in common]) if long_enough else []
            row: dict = {"a": a, "b": b, "bars": len(common), **pair_lead(ra, rb, max_lag)}
            if ra and rb:
                row["thirds"] = _segment_leaders(ra, rb, max_lag, 3)
                row["halves"] = _halves(ra, rb, max_lag)
            else:
                row["thirds"] = [None, None, None]
                row["halves"] = _empty_halves()
            pairs.append(row)

    def role(p: dict, x: str) -> str | None:
        return "a" if p["a"] == x else "b" if p["b"] == x else None

    def bucket(x: str, mine: list[dict], which: str) -> dict:
        decided = votes = 0
        for p in mine:
            hv = p["halves"]["volatile_half"]
            key = hv if which == "volatile" else ("second" if hv == "first" else "first")
            seg = p["halves"][key]
            if seg is None or seg["leader"] is None:
                continue
            decided += 1
            if p[seg["leader"]] == x:
                votes += 1
        return {"decided": decided, "frequency": None if not decided else round(votes / decided, 3)}

    def thirds_led(x: str, mine: list[dict]) -> int:
        led = 0
        for t in range(3):
            wins: dict[str, int] = {}
            for p in mine:
                seg = p["thirds"][t]
                if seg is None or seg["leader"] is None:
                    continue
                who = p[seg["leader"]]
                wins[who] = wins.get(who, 0) + 1
            mine_wins = wins.get(x, 0)
            others = max((w for v, w in wins.items() if v != x), default=0)
            if mine_wins > 0 and mine_wins > others:
                led += 1
        return led

    rows: list[dict] = []
    for x in venues:
        mine = [p for p in pairs if role(p, x) is not None]
        decided_pairs = [p for p in mine if p["leader"] is not None]
        votes = sum(1 for p in decided_pairs if p["leader"] == role(p, x))
        lags = [p["lag_bars"] for p in decided_pairs if p["leader"] == role(p, x)]
        ci = wilson_interval(votes, len(decided_pairs))
        rows.append(
            {
                "exchange": x,
                "decided": len(decided_pairs),
                "lead_votes": votes,
                "frequency": None if not decided_pairs else round(votes / len(decided_pairs), 3),
                "ci_pct": None if ci is None else [round(ci[0] * 100, 1), round(ci[1] * 100, 1)],
                "median_lead_bars": None if not lags else round(float(statistics.median(lags)), 1),
                "thirds_led": thirds_led(x, mine),
                "quiet": bucket(x, mine, "quiet"),
                "volatile": bucket(x, mine, "volatile"),
                "error": None,
            }
        )

    bars = [p["bars"] for p in pairs if p["bars"] > 0]
    usable = [p["bars"] for p in pairs if p["bars"] >= min_bars]
    if len(venues) < 2 or not usable:
        state, leader = "insufficient_data", None
    else:
        candidates = [
            r
            for r in rows
            if r["lead_votes"] >= MIN_LEAD_VOTES and (r["frequency"] or 0.0) >= LEAD_SHARE_MIN
        ]
        stable = [r for r in candidates if r["thirds_led"] >= STABLE_THIRDS_MIN]
        if len(candidates) == 1 and len(stable) == 1:
            state, leader = "stable_leader", candidates[0]["exchange"]
        elif len(candidates) >= 2:
            state, leader = "contested", None
        else:
            state, leader = "no_stable_leadership", None
    return {
        "state": state,
        "leader": leader,
        "bars_min": min(bars, default=0),
        "bars_max": max(bars, default=0),
        "pairs_total": len(pairs),
        "pairs_decided": sum(1 for p in pairs if p["leader"] is not None),
        "sources": rows,
        "pairs": pairs,
    }
