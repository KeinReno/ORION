"""Строгая проверка прогнозов (Forecast Engine, фаза 3): walk-forward и калибровка.

В каждой исторической точке прогноз строится по данным до неё включительно и сразу
оценивается по факту, который на момент прогноза был неизвестен. Прогноз считает то же
ядро (`forecast_core`), что показывает снимок, — оценщик не может незаметно разойтись
с продуктом; причинность ядра закреплена тестом отсутствия утечки.

Измеряется калибровка вероятности «вверх» (Brier, логлосс, кривая надёжности, смещение,
точность направления), покрытие полос (90/80/50%), CRPS терминального распределения и
разрезы по режимам. Модель сравнивается с наивными базовыми: случайное блуждание (p = 0.5)
и безусловная историческая частота исходов того же горизонта. Итог — вердикт надёжности
GOOD/LIMITED/POOR/INSUFFICIENT DATA; пороги не прячутся — они возвращаются в ответе числами.

Проверка ничего не сохраняет: снимки создаёт только POST /api/forecast.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from compass.forecast import (
    FEATURE_VERSION,
    HORIZON_DEFAULT,
    HORIZON_MAX,
    HORIZON_MIN,
    MODEL,
    MODEL_VERSION,
    Prepared,
    forecast_core,
    prepare,
)

MIN_SCORED = 30  # меньше оценённых точек — вердикт был бы случайным: insufficient_data
SKILL_GOOD_PCT = 5.0  # настолько Brier должен быть лучше базовой модели для good
SKILL_LIMITED_PCT = -2.0  # заметно хуже — poor
COVER_GOOD_PCT = (85.0, 95.0)  # фактическое покрытие 90%-й полосы при номинале 90%
COVER_LIMITED_PCT = (75.0, 99.0)
BINS = 10  # бины кривой надёжности
MAX_POINTS_DEFAULT = 120
_COVER_LEVELS = ((90, 5, 95), (80, 10, 90), (50, 25, 75))  # номинал, нижний и верхний процентили


def _r(x: float, nd: int) -> float | None:
    v = float(x)
    return round(v, nd) if math.isfinite(v) else None


def _crps(term: np.ndarray, y: float) -> float:
    """CRPS эмпирического распределения: E|X − y| − ½·E|X − X′|.
    Двойная сумма по отсортированному массиву считается за O(n log n), без пар n²."""
    xs = np.sort(term)
    n = xs.size
    k = 2.0 * np.arange(1, n + 1, dtype=float) - n - 1.0
    pair_sum = float((xs * k).sum())  # Σ_{i<j} (x_j − x_i) ≥ 0
    return float(np.abs(xs - y).mean() - pair_sum / (n * n))


def _agg(ps: list[float], ys: list[int]) -> dict[str, Any]:
    n = len(ps)
    if n == 0:
        return {"n": 0, "brier": None, "logloss": None, "accuracy_pct": None, "bias_pct": None}
    p = np.asarray(ps, dtype=float)
    y = np.asarray(ys, dtype=float)
    pc = np.clip(p, 1e-6, 1 - 1e-6)
    return {
        "n": n,
        "brier": _r(float(((p - y) ** 2).mean()), 4),
        "logloss": _r(float(-(y * np.log(pc) + (1 - y) * np.log(1 - pc)).mean()), 4),
        "accuracy_pct": _r(float(((p > 0.5) == (y == 1.0)).mean()) * 100.0, 1),
        "bias_pct": _r((float(p.mean()) - float(y.mean())) * 100.0, 1),
    }


@dataclass(frozen=True, slots=True)
class Point:
    ts: int
    i: int
    p_up: float
    y: int
    terminal_pct: float
    crps: float  # в долях, как и terminal_pct до умножения на 100
    cover90: bool
    cover80: bool
    cover50: bool
    trend: str
    volatility: str


def _scored_point(p: Prepared, i: int, horizon: int, seed: int) -> Point:
    core = forecast_core(p, i, horizon=horizon, seed=seed)
    term = float(p.close[i + horizon] / p.close[i]) - 1.0
    term_sims = core.sims[:, -1]
    q5, q10, q25, q75, q90, q95 = (float(v) for v in np.percentile(term_sims, [5, 10, 25, 75, 90, 95]))
    return Point(
        ts=int(p.ts[i]),
        i=i,
        p_up=float((term_sims > 0.0).mean()),
        y=1 if term > 0.0 else 0,
        terminal_pct=term * 100.0,
        crps=_crps(term_sims, term),
        cover90=q5 <= term <= q95,
        cover80=q10 <= term <= q90,
        cover50=q25 <= term <= q75,
        trend=str(core.regime["trend"]),
        volatility=str(core.regime["volatility"]),
    )


def _curve(points: list[Point]) -> list[dict[str, Any]]:
    groups: list[list[Point]] = [[] for _ in range(BINS)]
    for pt in points:
        groups[min(int(pt.p_up * BINS), BINS - 1)].append(pt)
    out = []
    for b, grp in enumerate(groups):
        out.append({
            "from_pct": _r(b * 100.0 / BINS, 0),
            "to_pct": _r((b + 1) * 100.0 / BINS, 0),
            "count": len(grp),
            "mean_p_pct": _r(float(np.mean([g.p_up for g in grp])) * 100.0, 1) if grp else None,
            "actual_pct": _r(float(np.mean([g.y for g in grp])) * 100.0, 1) if grp else None,
        })
    return out


def _coverage(points: list[Point]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for level, _, _ in _COVER_LEVELS:
        flags = [getattr(pt, f"cover{level}") for pt in points]
        out[str(level)] = {
            "nominal_pct": level,
            "actual_pct": _r(float(np.mean(flags)) * 100.0, 1) if points else None,
            "covered": int(sum(flags)),
            "n": len(points),
        }
    return out


def _verdict(n: int, skill_pct: float | None, cov90: float | None) -> tuple[str, str]:
    if n < MIN_SCORED:
        return "insufficient_data", (
            f"Оценённых точек {n} — меньше {MIN_SCORED}: вердикт по ним был бы случайным."
        )
    assert skill_pct is not None and cov90 is not None  # при n ≥ MIN_SCORED агрегаты есть
    if skill_pct >= SKILL_GOOD_PCT and COVER_GOOD_PCT[0] <= cov90 <= COVER_GOOD_PCT[1]:
        return "good", (
            f"Brier-оценка лучше базовой модели на {skill_pct:.1f}%, покрытие 90%-й полосы "
            f"{cov90:.1f}% близко к номиналу."
        )
    reasons = []
    if skill_pct < SKILL_GOOD_PCT:
        reasons.append(f"преимущество над базовой моделью {skill_pct:+.1f}%")
    if not COVER_GOOD_PCT[0] <= cov90 <= COVER_GOOD_PCT[1]:
        reasons.append(f"покрытие 90%-й полосы {cov90:.1f}% при номинале 90%")
    if skill_pct >= SKILL_LIMITED_PCT and COVER_LIMITED_PCT[0] <= cov90 <= COVER_LIMITED_PCT[1]:
        return "limited", (
            "Заметного преимущества над базовой моделью нет: " + "; ".join(reasons)
            + ". Вероятностям пока верить осторожно."
        )
    return "poor", (
        "Прогноз хуже базовой модели или полосы не покрывают факт: " + "; ".join(reasons) + "."
    )


def _assumptions() -> list[str]:
    return [
        (
            "каждая точка оценивается только по данным до неё: ядро прогноза причинное, "
            "свечи правее точки в расчёт не попадают (закреплено тестом отсутствия утечки)"
        ),
        "модель и оценка — одно ядро forecast_core: измеряется то же распределение, что показывает снимок",
        (
            "«случайное блуждание» — вероятность вверх ровно 0.5; «безусловная частота» — доля "
            "положительных исходов горизонта среди всех окон истории до точки, включая перекрывающиеся"
        ),
        "симуляции — с фиксированным seed прогона: тот же seed и те же данные дают те же числа",
        "CRPS считается по эмпирическому распределению терминальных доходностей симуляций",
        "надёжность измерена по прошлому ряда; гарантий на будущее она не даёт",
    ]


def _warnings(points: list[Point], skipped: int, step: int, horizon: int, n: int) -> list[str]:
    out = ["Надёжность измерена по истории этого инструмента и таймфрейма — не переносите на другие ряды."]
    if skipped:
        out.append(f"Точек без достаточной истории для аналогов: {skipped}.")
    if step < horizon and len(points) > 1:
        out.append(
            "Окна оценки перекрываются (шаг меньше горизонта): метрики соседних точек коррелированы, "
            "вердикт от этого грубее."
        )
    if n < 100:
        out.append(f"Оценённых точек {n} — суждение о калибровке пока самое приблизительное.")
    return out


def _logistic_up(p, i: int, horizon: int) -> float:
    """P(рост) логистической регрессии на признаках только до точки i. Соперник M1, не чемпион."""
    stop = i - horizon + 1
    idx = np.flatnonzero(p.valid[:stop])
    if len(idx) > 240:
        idx = idx[-240:]
    if len(idx) < 40 or not np.isfinite(p.z[i]).all():
        return 0.5
    y = (p.close[idx + horizon] > p.close[idx]).astype(float)
    xb = np.column_stack([np.ones(len(idx)), p.z[idx]])
    w = np.zeros(xb.shape[1])
    for _ in range(20):
        pr = 1.0 / (1.0 + np.exp(-np.clip(xb @ w, -20, 20)))
        w -= 0.8 * (xb.T @ (pr - y) / len(y))
    z = float(np.concatenate([[1.0], p.z[i]]) @ w)
    return float(1.0 / (1.0 + math.exp(-max(-20.0, min(20.0, z)))))


def walk_forward(
    df: pd.DataFrame,
    *,
    horizon: int = HORIZON_DEFAULT,
    step: int = 0,
    max_points: int = MAX_POINTS_DEFAULT,
    seed: int = 0,
    until: int | None = None,
    btc: pd.DataFrame | None = None,
) -> dict[str, Any]:
    """Walk-forward проверка на истории: прогноз в каждой точке — только по прошлому,
    оценка — по факту. `until` — индекс последней оцениваемой свечи (по умолчанию —
    последняя, исход которой уже известен). `step` 0 — автоматический, кратный диапазону;
    слишком частый явный шаг увеличивается, чтобы уложиться в `max_points` (факт — в ответе)."""
    if not HORIZON_MIN <= horizon <= HORIZON_MAX:
        raise ValueError(f"Горизонт — от {HORIZON_MIN} до {HORIZON_MAX} свечей.")
    if max_points < 1:
        raise ValueError("max_points должен быть не меньше 1.")
    if len(df) == 0:
        raise ValueError("Пустой ряд: проверять нечего.")
    p = prepare(df, btc)
    n = len(df)
    if not p.valid.any():
        raise ValueError("Ряд слишком короткий или вырожденный: нет ни одного бара со всеми признаками.")
    first_fit = int(np.argmax(p.valid))
    last = (n - 1 - horizon) if until is None else int(until)
    if last < first_fit or last > n - 1 - horizon:
        raise ValueError(
            f"Нечего оценивать: последняя точка (индекс {last}) должна быть не меньше первой "
            f"полной ({first_fit}) и не больше {n - 1 - horizon} (чтобы исход в горизонте "
            f"{horizon} был известен)."
        )
    span = last - first_fit + 1
    step_req = int(step) if step and step > 0 else 0
    step_eff = max(step_req or 1, math.ceil(span / max_points))
    indices = list(range(first_fit, last + 1, step_eff))

    points: list[Point] = []
    skipped = 0
    for i in indices:
        try:
            points.append(_scored_point(p, i, horizon, seed))
        except ValueError:
            skipped += 1

    ps = [pt.p_up for pt in points]
    ys = [pt.y for pt in points]
    model_agg = _agg(ps, ys)
    rw_agg = _agg([0.5] * len(points), ys)
    y_all = (p.close[first_fit + horizon:last + 1 + horizon] > p.close[first_fit:last + 1]).astype(np.int64)
    cum = np.concatenate([[0], np.cumsum(y_all)])
    uncond = [float(cum[pt.i - first_fit + 1]) / (pt.i - first_fit + 1) for pt in points]
    uncond_agg = _agg(uncond, ys)
    logistic_agg = _agg([_logistic_up(p, pt.i, horizon) for pt in points], ys)

    skill_pct = None
    ref_name = None
    if model_agg["brier"] is not None:
        ref_name = "random_walk" if rw_agg["brier"] <= uncond_agg["brier"] else "unconditional"
        ref = min(rw_agg["brier"], uncond_agg["brier"])
        skill_pct = _r((1.0 - model_agg["brier"] / ref) * 100.0, 1) if ref > 0 else None
    cov = _coverage(points)
    cov90 = cov["90"]["actual_pct"]
    verdict, reason = _verdict(len(points), skill_pct, cov90)

    by_trend = [
        {"group": key, **_agg([pt.p_up for pt in points if pt.trend == key], [pt.y for pt in points if pt.trend == key])}
        for key in ("up", "down", "range")
    ]
    by_volatility = [
        {
            "group": key,
            **_agg(
                [pt.p_up for pt in points if pt.volatility == key],
                [pt.y for pt in points if pt.volatility == key],
            ),
        }
        for key in ("low", "normal", "high")
    ]
    return {
        "model": MODEL,
        "model_version": MODEL_VERSION,
        "feature_version": FEATURE_VERSION,
        "horizon": horizon,
        "seed": seed,
        "candles": n,
        "points": {
            "scored": len(points),
            "skipped": skipped,
            "step": step_eff,
            "requested_step": step_req or None,
            "max_points": max_points,
        },
        "range": (
            {"from_ts": points[0].ts, "to_ts": points[-1].ts} if points else None
        ),
        "probability": model_agg,
        "baselines": {"random_walk": rw_agg, "unconditional": uncond_agg, "logistic": logistic_agg},
        "challenger": {
            "name": "logistic",
            "role": "M2",
            "beats_champion": bool(
                logistic_agg["brier"] is not None
                and model_agg["brier"] is not None
                and logistic_agg["brier"] < model_agg["brier"]
            ),
            "note": (
                "Логистическая модель на тех же признаках — соперник M1, не замена. "
                "Прогноз на графике остаётся аналоговым, пока соперник не обгоняет его по Brier "
                "и не получает собственные полосы."
            ),
        },
        "skill_pct": skill_pct,
        "skill_reference": ref_name,
        "reliability_curve": _curve(points),
        "coverage": cov,
        "crps": {"mean_pct": _r(float(np.mean([pt.crps for pt in points])) * 100.0, 3) if points else None, "n": len(points)},
        "by_trend": by_trend,
        "by_volatility": by_volatility,
        "verdict": verdict,
        "verdict_reason": reason,
        "thresholds": {
            "min_scored": MIN_SCORED,
            "skill_good_pct": SKILL_GOOD_PCT,
            "skill_limited_pct": SKILL_LIMITED_PCT,
            "cover_good_pct": list(COVER_GOOD_PCT),
            "cover_limited_pct": list(COVER_LIMITED_PCT),
            "bins": BINS,
        },
        "assumptions": _assumptions(),
        "warnings": _warnings(points, skipped, step_eff, horizon, len(points)),
    }
