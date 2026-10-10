"""Прогноз-сценарии: распределение будущего из исторических аналогов.

Принцип — не «одна будущая линия», а распределение исходов похожих прошлых ситуаций.
Числа считаются только по закрытым свечам, доступным на момент прогноза: будущая свеча,
будущая статистика нормализации и «метка режима», посчитанная на будущем, в расчёт не
попадают. Проверяется тестом: расчёт в точке i не меняется от того, что правее i
дописаны свечи.

Вероятности зон и статус «вверх» показываются только если последняя walk-forward проверка
этого инструмента, таймфрейма и горизонта получила вердикт good. Иначе в ответе
probability: null и prob_up_status: not_calibrated. Реконструкция прошлого момента
позднюю проверку не подмешивает.

Снимок прогноза неизменяем (триггеры в БД): пересчёт создаёт новую запись, старая
остаётся такой, какой была сделана, — задним числом прогнозы не подчищаются.
"""

from __future__ import annotations

import json
import math
import time
import uuid
from dataclasses import dataclass, replace
from typing import Any

import numpy as np
import pandas as pd

from compass.db import Connection
from compass.indicators import adx, atr, rsi, sma

MODEL = "analogues"
MODEL_VERSION = "1"
FEATURE_VERSION = "2"

HORIZON_DEFAULT = 12
HORIZON_MIN = 1
HORIZON_MAX = 60

K_ANALOGUES = 200  # не больше аналогов в выборке, чтобы далёкие окна не размывали распределение
MIN_ANALOGUES = 30  # меньше — распределение не строим
PATHS = 5000  # траекторий бутстрапа
ROLL_WINDOW = 120  # окно z-оценок признаков
ROLL_MIN = 80  # минимум наблюдений, чтобы z-оценка считалась устойчивой
Z_CLIP = 5.0  # z-оценки ограничены: одиночный выброс не должен подавлять сходство окон
TREND_Z = 0.5  # порог «20-свечного» z-импульса для направления режима
VOL_RANK_WINDOW = 250  # окно ранга волатильности в собственном прошлом
VOL_RANK_MIN = 60
VOL_HIGH_RANK = 0.8
VOL_LOW_RANK = 0.2
SHOCK_MULT = 4.0  # свеча — «шок», если её ход в столько раз больше медианного

FEATURES = ("r1", "r5", "r20", "vol20", "atr14_pct", "rsi14", "d20", "d50", "slope50", "vol_ratio", "adx14", "btc_r20")
RANGE_LOOKBACK = 20
_BANDS = (5, 10, 25, 50, 75, 90, 95)


def _num(v: float | None, nd: int) -> float | None:
    if v is None:
        return None
    x = float(v)
    return round(x, nd) if math.isfinite(x) else None


def _fmt(x: float) -> str:
    return f"{x:.6g}"


@dataclass(frozen=True, slots=True)
class Prepared:
    ts: np.ndarray
    close: np.ndarray
    raw: np.ndarray  # (n, F) сырые значения признаков
    z: np.ndarray  # (n, F) z-оценки по скользящему окну
    valid: np.ndarray  # (n,) — все признаки конечны
    logret: np.ndarray


def _btc_r20(ts: np.ndarray, btc: pd.DataFrame | None) -> np.ndarray:
    """20-свечная доходность BTC на момент каждой свечи ряда. Будущий бар BTC не читается.
    Нет ряда — нули: признак не двигает расстояние аналогов."""
    n = len(ts)
    if btc is None or len(btc) < 21:
        return np.zeros(n)
    bts = btc["ts"].to_numpy(dtype=np.int64)
    close = btc["close"].to_numpy(dtype=float)
    j = np.searchsorted(bts, ts, side="right") - 1
    prev = j - 20
    out = np.zeros(n)
    ok = prev >= 0
    with np.errstate(divide="ignore", invalid="ignore"):
        out[ok] = np.log(close[j[ok]] / close[prev[ok]])
    out[~np.isfinite(out)] = 0.0
    return out


def prepare(df: pd.DataFrame, btc: pd.DataFrame | None = None) -> Prepared:
    """Признаки ряда. Всё скользящее и причинное: значение в баре t не зависит от t+1."""
    close = df["close"].astype(float)
    volume = df["volume"].astype(float)
    n = len(df)
    c = close.to_numpy()
    lr = np.zeros(n, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        lr[1:] = np.log(c[1:] / c[:-1])
    lr_series = pd.Series(lr)
    sma50 = sma(close, 50)
    raw = np.column_stack([
        lr,
        np.log(close / close.shift(5)).to_numpy(),
        np.log(close / close.shift(20)).to_numpy(),
        lr_series.rolling(20).std().to_numpy(),
        (atr(df, 14) / close).to_numpy(),
        rsi(close, 14).to_numpy(),
        (close / sma(close, 20) - 1).to_numpy(),
        (close / sma50 - 1).to_numpy(),
        (sma50 / sma50.shift(10) - 1).to_numpy(),
        (volume / volume.rolling(20).mean().replace(0, np.nan)).to_numpy(),
        adx(df, 14).to_numpy(dtype=float),
        _btc_r20(df["ts"].to_numpy(dtype=np.int64), btc),
    ])
    z = np.full((n, len(FEATURES)), np.nan)
    for k in range(len(FEATURES)):
        s = pd.Series(raw[:, k])
        m = s.rolling(ROLL_WINDOW, min_periods=ROLL_MIN).mean()
        sd = s.rolling(ROLL_WINDOW, min_periods=ROLL_MIN).std()
        zk = (s - m) / sd.replace(0, np.nan)
        # Плоское окно (нулевая дисперсия, например постоянный объём): значение не отклоняется
        # от нормы, z = 0. Без этого одна вырожденная колонка глушила бы весь ряд как невалидный.
        zk[sd.eq(0) & s.notna() & m.notna()] = 0.0
        z[:, k] = np.clip(zk, -Z_CLIP, Z_CLIP).to_numpy()
    valid = np.isfinite(z).all(axis=1) & np.isfinite(raw).all(axis=1) & (c > 0)
    return Prepared(df["ts"].to_numpy(dtype=np.int64), c, raw, z, valid, lr)


def feature_values(p: Prepared, i: int) -> dict[str, dict[str, float | None]]:
    return {
        name: {"value": _num(p.raw[i, k], 6), "z": _num(p.z[i, k], 3)}
        for k, name in enumerate(FEATURES)
    }


def detect_regime(p: Prepared, i: int) -> dict[str, Any]:
    """Режим на баре i: направление, ранг волатильности и признак шока. Всё — по прошлому."""
    vol20 = p.raw[i, FEATURES.index("vol20")]
    r20 = p.raw[i, FEATURES.index("r20")]
    z20 = r20 / (vol20 * math.sqrt(20)) if math.isfinite(vol20) and vol20 > 0 else float("nan")
    if not math.isfinite(z20):
        trend = "range"
    elif z20 >= TREND_Z:
        trend = "up"
    elif z20 <= -TREND_Z:
        trend = "down"
    else:
        trend = "range"

    lo = max(0, i - VOL_RANK_WINDOW + 1)
    window = p.raw[lo:i + 1, FEATURES.index("vol20")]
    window = window[np.isfinite(window)]
    rank = None
    if len(window) >= VOL_RANK_MIN and math.isfinite(vol20):
        rank = float((window <= vol20).mean())
    if rank is None:
        volatility = "normal"
    elif rank >= VOL_HIGH_RANK:
        volatility = "high"
    elif rank <= VOL_LOW_RANK:
        volatility = "low"
    else:
        volatility = "normal"

    moves = np.abs(p.logret[lo:i + 1])
    moves = moves[np.isfinite(moves)]
    med = float(np.median(moves)) if len(moves) >= VOL_RANK_MIN else 0.0
    shock = bool(med > 0 and abs(p.logret[i]) >= SHOCK_MULT * med)

    return {
        "trend": trend,
        "volatility": volatility,
        "shock": shock,
        "trend_z20": _num(z20, 3),
        "vol_rank": _num(rank, 3),
        "vol_window": VOL_RANK_WINDOW,
    }


@dataclass(frozen=True, slots=True)
class AnalogueSet:
    index: np.ndarray  # позиции окон-аналогов в ряду
    distance: np.ndarray  # расстояние каждого аналога до текущего окна
    forward: np.ndarray  # (k, horizon) накопленная простая доходность к каждому шагу
    candidates: int  # сколько окон рассматривалось
    separation: int
    same_regime: int  # сколько кандидатов того же направления
    regime_filtered: bool  # аналоги взяты только из того же направления


def _trend_labels(p: Prepared) -> np.ndarray:
    """Направление на каждом баре — та же формула, что у detect_regime, сразу на весь ряд."""
    vol = p.raw[:, FEATURES.index("vol20")]
    r20 = p.raw[:, FEATURES.index("r20")]
    with np.errstate(divide="ignore", invalid="ignore"):
        z = r20 / (vol * math.sqrt(20))
    labels = np.full(len(z), "range", dtype=object)
    labels[np.isfinite(z) & (z >= TREND_Z)] = "up"
    labels[np.isfinite(z) & (z <= -TREND_Z)] = "down"
    return labels


def find_analogues(p: Prepared, i: int, horizon: int, k: int = K_ANALOGUES) -> AnalogueSet:
    """Окна, похожие на текущее, чей исход уже известен. Будущее не подсматривается:
    кандидат j допускается, только когда j + horizon <= i, а выбранные окна не пересекаются."""
    stop = i - horizon + 1
    if stop <= 0:
        raise ValueError(
            f"Для горизонта {horizon} нужно больше истории: ряд слишком короткий (свечей {len(p.close)})."
        )
    candidates = np.flatnonzero(p.valid[:stop])
    if len(candidates) < MIN_ANALOGUES:
        raise ValueError(
            f"Мало истории для горизонта {horizon}: подходящих окон {len(candidates)}, "
            f"нужно не меньше {MIN_ANALOGUES}. Дайте больше свечей или уменьшите горизонт."
        )
    n_all = len(candidates)
    trends = _trend_labels(p)
    same = candidates[trends[candidates] == trends[i]]

    def _pick(pool: np.ndarray) -> tuple[list[int], list[float]]:
        dist = np.linalg.norm(p.z[pool] - p.z[i], axis=1)
        order = np.argsort(dist, kind="stable")
        picked: list[int] = []
        picked_dist: list[float] = []
        for pos in order:
            j = int(pool[pos])
            if all(abs(j - c) >= horizon for c in picked):
                picked.append(j)
                picked_dist.append(float(dist[pos]))
                if len(picked) >= k:
                    break
        return picked, picked_dist

    chosen, chosen_dist = _pick(same)
    regime_filtered = len(chosen) >= MIN_ANALOGUES
    if not regime_filtered:
        chosen, chosen_dist = _pick(candidates)
    if len(chosen) < MIN_ANALOGUES:
        raise ValueError(
            f"Мало непересекающихся аналогов: нашлось {len(chosen)} из нужных {MIN_ANALOGUES} "
            f"при горизонте {horizon}. Дайте больше истории или уменьшите горизонт."
        )
    idx = np.asarray(chosen, dtype=np.int64)
    dst = np.asarray(chosen_dist, dtype=float)
    fwd = p.close[idx[:, None] + np.arange(1, horizon + 1)] / p.close[idx, None] - 1.0
    ok = np.isfinite(fwd).all(axis=1)
    if not ok.all():
        idx, dst, fwd = idx[ok], dst[ok], fwd[ok]
        if len(idx) < MIN_ANALOGUES:
            raise ValueError("После отбраковки битых окон аналогов осталось слишком мало.")
    return AnalogueSet(idx, dst, fwd, n_all, horizon, len(same), regime_filtered)


def simulate(forward: np.ndarray, paths: int, seed: int) -> np.ndarray:
    """Бутстрап целых путей: тянем случайный аналог целиком, а не отдельные шаги,
    чтобы форма пути (сначала просадка, потом рост) сохранялась."""
    rng = np.random.default_rng(seed)
    return forward[rng.integers(0, len(forward), size=paths)]


def barrier_probs(
    sims: np.ndarray, base_price: float, stop: float, target: float, *, publish: bool
) -> dict[str, Any]:
    """Доля путей, где цель достигнута раньше стопа, и наоборот. Одна свеча с обоими уровнями
    считается стопом: худший исход. Числа скрыты, пока калибровка не good."""
    if not (0 < stop < base_price < target):
        return {
            "status": "invalid",
            "stop": stop,
            "target": target,
            "target_before_stop_pct": None,
            "stop_before_target_pct": None,
            "note": "Для лонга стоп должен быть ниже основания, цель — выше.",
        }
    prices = base_price * (1.0 + sims)
    stop_hit = prices <= stop
    tgt_hit = prices >= target
    stop_any = stop_hit.any(axis=1)
    tgt_any = tgt_hit.any(axis=1)
    stop_i = np.where(stop_any, stop_hit.argmax(axis=1), sims.shape[1])
    tgt_i = np.where(tgt_any, tgt_hit.argmax(axis=1), sims.shape[1])
    target_first = tgt_any & (tgt_i < stop_i)
    stop_first = stop_any & (stop_i <= tgt_i)
    note = (
        "Доли путей, где уровень достигнут по закрытиям. Это не гарантия исполнения и не ордер."
        if publish else
        "Уровни посчитаны, но доли скрыты: проверка ряда ещё не получила вердикт «надёжно»."
    )
    return {
        "status": "calibrated" if publish else "not_calibrated",
        "stop": _num(stop, 6),
        "target": _num(target, 6),
        "target_before_stop_pct": _num(float(target_first.mean()) * 100, 1) if publish else None,
        "stop_before_target_pct": _num(float(stop_first.mean()) * 100, 1) if publish else None,
        "note": note,
    }


def distribution(
    sims: np.ndarray,
    base_price: float,
    seed: int,
    *,
    publish: bool = False,
    high: float | None = None,
    low: float | None = None,
) -> dict[str, Any]:
    steps = []
    for k in range(sims.shape[1]):
        q = np.percentile(sims[:, k], _BANDS)
        steps.append({
            "step": k + 1,
            **{f"p{b}": _num(base_price * (1 + v), 6) for b, v in zip(_BANDS, q)},
        })
    term = sims[:, -1]
    tq = np.percentile(term, _BANDS)
    return {
        "paths": int(sims.shape[0]),
        "seed": seed,
        "basis": "закрытия свечей",
        "steps": steps,
        "terminal": {
            **{f"p{b}_pct": _num(v * 100, 2) for b, v in zip(_BANDS, tq)},
            "mean_pct": _num(float(term.mean()) * 100, 2),
            "prob_up_pct": _num(float((term > 0).mean()) * 100, 1),
            "prob_up_status": "calibrated" if publish else "not_calibrated",
        },
        "mae_median_pct": _num(float(np.median(sims.min(axis=1))) * 100, 2),
        "mfe_median_pct": _num(float(np.median(sims.max(axis=1))) * 100, 2),
        "range": _range_block(sims, base_price, high, low, publish),
    }


def _with_barriers(dist: dict[str, Any], barriers: dict[str, Any] | None) -> dict[str, Any]:
    if barriers is not None:
        dist["barriers"] = barriers
    return dist


def _range_block(
    sims: np.ndarray, base_price: float, high: float | None, low: float | None, publish: bool
) -> dict[str, Any] | None:
    if high is None or low is None or not high > low:
        return None
    prices = base_price * (1.0 + sims)
    up = (prices > high).any(axis=1)
    down = (prices < low).any(axis=1)
    return {
        "lookback": RANGE_LOOKBACK,
        "high": _num(high, 6),
        "low": _num(low, 6),
        "breakout_pct": _num(float(up.mean()) * 100, 1) if publish else None,
        "breakdown_pct": _num(float(down.mean()) * 100, 1) if publish else None,
        "inside_pct": _num(float((~up & ~down).mean()) * 100, 1) if publish else None,
        "status": "calibrated" if publish else "not_calibrated",
    }


def build_scenarios(sims: np.ndarray, base_price: float, *, publish: bool = False) -> list[dict[str, Any]]:
    """Три зоны распределения: ниже p25 — медвежья, p25–p75 — базовая, выше p75 — растущая.
    Доля путей в зоне становится probability только при publish (вердикт good)."""
    term = sims[:, -1]
    q = dict(zip(_BANDS, (float(x) for x in np.percentile(term, _BANDS))))
    groups = (
        ("bear", "Медвежий", term <= q[25], q[5], q[25]),
        ("base", "Базовый", (term > q[25]) & (term < q[75]), q[25], q[75]),
        ("bull", "Растущий", term >= q[75], q[75], q[95]),
    )
    out = []
    for sid, label, mask, lo, hi in groups:
        empty = not bool(mask.any())
        sub = sims if empty else sims[mask]
        med = np.median(sub, axis=0)
        median_pct = float(np.median(term[mask])) if not empty else float(np.median(term))
        inv_low = base_price * (1 + lo) if sid in ("base", "bull") else None
        inv_high = base_price * (1 + hi) if sid in ("bear", "base") else None
        if sid == "bear":
            text = f"Возврат выше {_fmt(inv_high)} к горизонту отменяет медвежий сценарий: исход оказался в базовом или растущем диапазоне."
        elif sid == "bull":
            text = f"Возврат ниже {_fmt(inv_low)} к горизонту отменяет растущий сценарий: исход оказался в базовом или медвежьем диапазоне."
        else:
            text = f"Выход за границы {_fmt(inv_low)}–{_fmt(inv_high)} к горизонту отменяет базовый сценарий: распределение сдвинулось к медвежьему или растущему."
        share = None if empty else _num(float(mask.mean()) * 100, 1)
        out.append({
            "id": sid,
            "label": label,
            "probability": share if publish else None,
            "probability_status": "calibrated" if publish and share is not None else "not_calibrated",
            "empty_group": empty,
            "terminal_median_pct": _num(median_pct * 100, 2),
            "terminal_range_pct": [_num(lo * 100, 2), _num(hi * 100, 2)],
            "median_path": [_num(base_price, 6), *(_num(base_price * (1 + v), 6) for v in med)],
            "invalidation": {"low": _num(inv_low, 6), "high": _num(inv_high, 6), "text": text},
        })
    return out


_CAL_NOTES = {
    "good": (
        "Вердикт проверки — надёжно. Доли путей в зонах и вероятность роста показаны: "
        "это частота похожих прошлых исходов, не обещание."
    ),
    "limited": "Вердикт проверки — ограниченно. Вероятности по-прежнему скрыты.",
    "poor": "Вердикт проверки — слабо. Вероятности скрыты.",
    "insufficient_data": "Проверка сохранена, оценённых точек мало. Вероятности скрыты.",
}


def calibration_record(evaluation: dict[str, Any] | None) -> dict[str, Any]:
    """Состояние калибровки снимка. Без проверки — not_measured. Числа вероятностей
    включаются отдельно, только при вердикте good."""
    if not evaluation:
        return {
            "state": "not_measured",
            "verdict": "insufficient_data",
            "metrics": None,
            "note": (
                "Калибровка не измерена: вероятности сценариев скрыты до проверки walk-forward. "
                "Полосы показывают разброс прошлых исходов похожих ситуаций, а не вероятности."
            ),
        }
    verdict = str(evaluation.get("verdict") or "insufficient_data")
    if verdict not in _CAL_NOTES:
        verdict = "insufficient_data"
    reason = str(evaluation.get("verdict_reason") or "").strip()
    note = _CAL_NOTES[verdict]
    if reason:
        note = f"{note} {reason}"
    return {
        "state": "measured",
        "verdict": verdict,
        "metrics": {
            "skill_pct": evaluation.get("skill_pct"),
            "brier": evaluation.get("brier"),
            "coverage_90_pct": evaluation.get("coverage_90"),
            "points": evaluation.get("points_scored"),
            "measured_at": evaluation.get("measured_at"),
            "data_hash": evaluation.get("data_hash"),
        },
        "note": note,
    }


def assumptions(*, probabilities_shown: bool = False) -> list[str]:
    return [
        (
            "признаки считаются только по закрытым свечам и z-оцениваются по скользящему окну "
            f"{ROLL_WINDOW} — будущее в расчёт не попадает"
        ),
        f"z-оценки ограничены ±{Z_CLIP:g}, чтобы одиночные выбросы не подавляли сходство окон",
        (
            "аналоги — непересекающиеся окна с зазором не меньше горизонта: исход каждого "
            "целиком известен на момент прогноза"
        ),
        (
            f"траектории — бутстрап целых путей аналогов ({PATHS} прогонов): форма пути "
            "сохраняется, шаги не перемешиваются"
        ),
        (
            "полосы и сценарии — по закрытиям свечей: внутрисвечные экстремумы не учитываются, "
            "MAE/MFE посчитаны по закрытиям"
        ),
        (
            "доли зон и вероятность роста показаны, потому что walk-forward по этому ряду "
            "получил вердикт «надёжно»: это частота похожих прошлых исходов, не обещание"
            if probabilities_shown
            else
            "вероятности сценариев не показываются, пока walk-forward не получит вердикт "
            "«надёжно»: сейчас это границы полос, а не вероятности"
        ),
    ]


def _warnings(regime: dict[str, Any], chosen: int, data_stale: bool, regime_filtered: bool = True) -> list[str]:
    out = ["Сценарии — распределение похожих прошлых ситуаций, а не предсказание будущего."]
    if not regime_filtered:
        out.append("Окон того же направления мало: аналоги искались по всему ряду, без отбора по режиму.")
    if data_stale:
        out.append("Данные могли устареть: источник недоступен, показан кэш.")
    if chosen < 2 * MIN_ANALOGUES:
        out.append(f"Аналогов мало ({chosen}): полосы грубее, чем при глубокой истории.")
    if regime["shock"]:
        out.append(
            "Последняя свеча — резкое движение против обычного: прошлые аналоги могут "
            "не описывать текущее состояние."
        )
    return out


@dataclass(frozen=True, slots=True)
class ForecastCore:
    """Ядро прогноза: режим, аналоги, симуляции. Снимок и walk-forward берут одно ядро —
    оценщик не может незаметно разойтись с тем, что видит пользователь."""

    ts: int
    base: float
    regime: dict[str, Any]
    analog: AnalogueSet
    sims: np.ndarray  # (paths, horizon), накопленная простая доходность


def forecast_core(p: Prepared, i: int, *, horizon: int, seed: int) -> ForecastCore:
    """Ядро прогноза в точке i по уже посчитанным признакам. Все операции причинные:
    значение в i не зависит от свечей правее i (проверено тестом отсутствия утечки)."""
    if not p.valid[i]:
        first = int(np.argmax(p.valid)) if p.valid.any() else 0
        need = first + 1 + horizon * (MIN_ANALOGUES + 1)
        raise ValueError(
            f"Для прогноза нужно больше закрытых свечей: ориентировочно не меньше {need} "
            f"при горизонте {horizon} (получено {len(p.close)})."
        )
    analog = find_analogues(p, i, horizon)
    return ForecastCore(
        ts=int(p.ts[i]),
        base=float(p.close[i]),
        regime=detect_regime(p, i),
        analog=analog,
        sims=simulate(analog.forward, PATHS, seed),
    )


def forecast_at(
    df: pd.DataFrame,
    i: int,
    *,
    horizon: int,
    seed: int,
    data_stale: bool = False,
    evaluation: dict[str, Any] | None = None,
    btc: pd.DataFrame | None = None,
    stop: float | None = None,
    target: float | None = None,
) -> dict[str, Any]:
    """Прогноз в точке i. i — индекс последней закрытой свечи, видимой прогнозу.
    Публичное: на нём строится walk-forward проверка (фаза 3) без подсматривания.
    evaluation — уже посчитанная проверка этого ряда; в ядро и в аналоги она не входит."""
    p = prepare(df, btc)
    core = forecast_core(p, i, horizon=horizon, seed=seed)
    analog = core.analog
    d_min = float(analog.distance.min())
    d_med = float(np.median(analog.distance))
    d_max = float(analog.distance.max())
    publish = bool(evaluation and evaluation.get("verdict") == "good")
    top = [
        {
            "ts": int(p.ts[j]),
            "distance": _num(d, 3),
            "forward_terminal_pct": _num(float(analog.forward[n, -1]) * 100, 2),
        }
        for n, (j, d) in enumerate(zip(analog.index[:10], analog.distance[:10], strict=True))
    ]
    return {
        "last_ts": core.ts,
        "base_price": _num(core.base, 6),
        "horizon": horizon,
        "regime": core.regime,
        "features": feature_values(p, i),
        "analogues": {
            "candidates": analog.candidates,
            "chosen": len(analog.index),
            "separation": analog.separation,
            "distance": {"min": _num(d_min, 3), "median": _num(d_med, 3), "max": _num(d_max, 3)},
            "span": {"from_ts": int(p.ts[analog.index.min()]), "to_ts": int(p.ts[analog.index.max()])},
            "same_regime": analog.same_regime,
            "regime_filtered": analog.regime_filtered,
            "top": top,
        },
        "distribution": _with_barriers(
            distribution(
                core.sims, core.base, seed, publish=publish,
                high=float(df["high"].iloc[max(0, i - RANGE_LOOKBACK + 1):i + 1].max()),
                low=float(df["low"].iloc[max(0, i - RANGE_LOOKBACK + 1):i + 1].min()),
            ),
            barrier_probs(core.sims, core.base, stop, target, publish=publish)
            if stop is not None and target is not None else None,
        ),
        "scenarios": build_scenarios(core.sims, core.base, publish=publish),
        "calibration": calibration_record(evaluation),
        "assumptions": assumptions(probabilities_shown=publish),
        "warnings": _warnings(core.regime, len(analog.index), data_stale, analog.regime_filtered),
    }


def forecast_from_history(
    df: pd.DataFrame,
    *,
    horizon: int = HORIZON_DEFAULT,
    seed: int = 0,
    data_stale: bool = False,
    evaluation: dict[str, Any] | None = None,
    btc: pd.DataFrame | None = None,
    stop: float | None = None,
    target: float | None = None,
) -> dict[str, Any]:
    """Распределение будущего из исторических аналогов последнего закрытого бара."""
    if not HORIZON_MIN <= horizon <= HORIZON_MAX:
        raise ValueError(f"Горизонт — от {HORIZON_MIN} до {HORIZON_MAX} свечей.")
    if len(df) == 0:
        raise ValueError("Пустой ряд: прогноз строить не из чего.")
    return forecast_at(
        df, len(df) - 1, horizon=horizon, seed=seed, data_stale=data_stale,
        evaluation=evaluation, btc=btc, stop=stop, target=target,
    )


# --- неизменяемые снимки ---

@dataclass(frozen=True, slots=True)
class ForecastSnapshot:
    market: str
    symbol: str
    tf: str
    source: str
    last_ts: int
    base_price: float
    horizon: int
    data_hash: str
    candles: int
    data_info: dict[str, Any]
    regime: dict[str, Any]
    features: dict[str, Any]
    analogues: dict[str, Any]
    distribution: dict[str, Any]
    scenarios: list[dict[str, Any]]
    calibration: dict[str, Any]
    assumptions: list[str]
    warnings: list[str]
    model: str = MODEL
    model_version: str = MODEL_VERSION
    feature_version: str = FEATURE_VERSION
    id: int | None = None
    uid: str | None = None
    created_at: int | None = None


_JSON_COLUMNS = (
    "data_info", "regime", "features", "analogues", "distribution", "scenarios",
    "calibration", "assumptions", "warnings",
)
_COLUMNS = (
    "id, uid, created_at, market, symbol, tf, source, last_ts, base_price, horizon, "
    "model, model_version, feature_version, data_hash, candles, " + ", ".join(_JSON_COLUMNS)
)
_ROW_FIELDS = tuple(c.strip() for c in _COLUMNS.split(","))


def _row(row: tuple) -> ForecastSnapshot:
    d = dict(zip(_ROW_FIELDS, row, strict=True))
    for name in _JSON_COLUMNS:
        d[name] = json.loads(d[name])
    return ForecastSnapshot(**d)


class ForecastStore:
    """Снимки прогнозов. Записи неизменяемы (триггеры в БД): история не подчищается."""

    def __init__(self, conn: Connection) -> None:
        self._conn = conn
        self._lock = conn.lock

    def add(self, f: ForecastSnapshot) -> ForecastSnapshot:
        f = replace(f, uid=f.uid or uuid.uuid4().hex, created_at=f.created_at or int(time.time()))
        values = (
            f.uid, f.created_at, f.market, f.symbol, f.tf, f.source, f.last_ts, f.base_price,
            f.horizon, f.model, f.model_version, f.feature_version, f.data_hash, f.candles,
            *(json.dumps(getattr(f, name), ensure_ascii=False, sort_keys=True, default=str) for name in _JSON_COLUMNS),
        )
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO forecasts (uid, created_at, market, symbol, tf, source, last_ts, base_price, "
                "horizon, model, model_version, feature_version, data_hash, candles, "
                + ", ".join(_JSON_COLUMNS) + ") "
                "VALUES (" + ", ".join("?" * len(values)) + ")",
                values,
            )
        return replace(f, id=int(cur.lastrowid))

    def get(self, uid: str) -> ForecastSnapshot | None:
        with self._lock:
            row = self._conn.execute(f"SELECT {_COLUMNS} FROM forecasts WHERE uid = ?", (uid,)).fetchone()
        return _row(row) if row else None

    def list(self, market: str | None = None, symbol: str | None = None, tf: str | None = None, limit: int = 50) -> list[ForecastSnapshot]:
        where, args = [], []
        for col, val in (("market", market), ("symbol", symbol), ("tf", tf)):
            if val:
                where.append(f"{col} = ?")
                args.append(val)
        sql = f"SELECT {_COLUMNS} FROM forecasts" + (f" WHERE {' AND '.join(where)}" if where else "")
        with self._lock:
            rows = self._conn.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, limit)).fetchall()
        return [_row(r) for r in rows]

    def add_evaluation(
        self,
        *,
        market: str,
        symbol: str,
        tf: str,
        horizon: int,
        data_hash: str,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        """Дописывает проверку. Строки не обновляются: снимок берёт последнюю подходящую."""
        prob = result.get("probability") or {}
        cov = (result.get("coverage") or {}).get("90") or {}
        created = int(time.time())
        row = (
            created,
            market,
            symbol,
            tf,
            horizon,
            str(result.get("model") or MODEL),
            str(result.get("model_version") or MODEL_VERSION),
            str(result.get("feature_version") or FEATURE_VERSION),
            data_hash,
            str(result.get("verdict") or "insufficient_data"),
            str(result.get("verdict_reason") or ""),
            result.get("skill_pct"),
            prob.get("brier"),
            cov.get("actual_pct"),
            int((result.get("points") or {}).get("scored") or 0),
        )
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO forecast_evaluations (created_at, market, symbol, tf, horizon, model, "
                "model_version, feature_version, data_hash, verdict, verdict_reason, skill_pct, brier, "
                "coverage_90, points_scored) VALUES (" + ", ".join("?" * len(row)) + ")",
                row,
            )
        return self._evaluation_dict(row)

    def latest_evaluation(
        self,
        market: str,
        symbol: str,
        tf: str,
        horizon: int,
        *,
        model: str = MODEL,
        model_version: str = MODEL_VERSION,
        feature_version: str = FEATURE_VERSION,
    ) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT created_at, market, symbol, tf, horizon, model, model_version, feature_version, "
                "data_hash, verdict, verdict_reason, skill_pct, brier, coverage_90, points_scored "
                "FROM forecast_evaluations WHERE market = ? AND symbol = ? AND tf = ? AND horizon = ? "
                "AND model = ? AND model_version = ? AND feature_version = ? ORDER BY id DESC LIMIT 1",
                (market, symbol, tf, horizon, model, model_version, feature_version),
            ).fetchone()
        return self._evaluation_dict(row) if row else None

    def list_evaluations(
        self, market: str, symbol: str, tf: str | None = None, limit: int = 20
    ) -> list[dict[str, Any]]:
        sql = (
            "SELECT created_at, market, symbol, tf, horizon, model, model_version, feature_version, "
            "data_hash, verdict, verdict_reason, skill_pct, brier, coverage_90, points_scored "
            "FROM forecast_evaluations WHERE market = ? AND symbol = ?"
        )
        args: list[Any] = [market, symbol]
        if tf:
            sql += " AND tf = ?"
            args.append(tf)
        with self._lock:
            rows = self._conn.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, limit)).fetchall()
        return [self._evaluation_dict(r) | {"tf": r[3], "horizon": r[4], "model_version": r[6]} for r in rows]

    @staticmethod
    def _evaluation_dict(row: tuple) -> dict[str, Any]:
        created, _market, _symbol, _tf, _horizon, _model, _mv, _fv, data_hash, verdict, reason, skill, brier, cov, points = row
        return {
            "verdict": verdict,
            "verdict_reason": reason,
            "skill_pct": skill,
            "brier": brier,
            "coverage_90": cov,
            "points_scored": points,
            "measured_at": created,
            "data_hash": data_hash,
        }


def forecast_dto(f: ForecastSnapshot) -> dict[str, Any]:
    d = {k: getattr(f, k) for k in ForecastSnapshot.__dataclass_fields__}
    d["summary"] = {
        "trend": f.regime.get("trend"),
        "volatility": f.regime.get("volatility"),
        "shock": f.regime.get("shock"),
        "calibration": f.calibration.get("verdict"),
        "chosen_analogues": f.analogues.get("chosen"),
    }
    return d


def forecast_brief(f: ForecastSnapshot) -> dict[str, Any]:
    return {
        "uid": f.uid,
        "market": f.market,
        "symbol": f.symbol,
        "tf": f.tf,
        "created_at": f.created_at,
        "last_ts": f.last_ts,
        "base_price": f.base_price,
        "horizon": f.horizon,
        "model": f.model,
        "model_version": f.model_version,
        "trend": f.regime.get("trend"),
        "volatility": f.regime.get("volatility"),
        "shock": f.regime.get("shock"),
        "calibration": f.calibration.get("verdict"),
        "chosen_analogues": f.analogues.get("chosen"),
        "data_stale": bool(f.data_info.get("stale")),
        "warnings": len(f.warnings),
    }
