"""Стратегия на свечах графика: что она показывала бы на любой истории и любом таймфрейме.

Записанные в базу сигналы есть только с момента, когда тикер попал в наблюдение, и только на одном
таймфрейме рынка. Здесь то же правило считается заново по тем свечам, что видны на графике: получаются
сделки «вход → выход», линии самой стратегии и расстояние до следующего сигнала. Это реконструкция
по закрытым свечам, а не журнал того, что приложение действительно присылало.

Цены — по закрытию сигнальной свечи (как у записанных сигналов). Бэктест исполняет по открытию следующей
свечи, поэтому здесь же отдаётся и такая цена: разницу видно, а не прячется.
Доходность без комиссий и проскальзывания: это оценка идеи, а не результат счёта.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from compass.indicators import atr
from compass.signals import atr_stop
from compass.strategies import Strategy

TARGET_R = 2.0  # ориентир цели: вход + 2·(вход − стоп); как target_r в бэктесте
TRIGGER_RANGE = 0.30  # дальше ±30% от цены триггер не ищем: он ни о чём не говорит
_GRID = 40
_BISECT = 18


def _num(v: float) -> float | None:
    f = float(v)
    return None if math.isnan(f) or math.isinf(f) else round(f, 8)


def _pnl(entry: float, exit_: float) -> float:
    return round((exit_ / entry - 1) * 100, 3)


def build_trades(df: pd.DataFrame, target: pd.Series, band: pd.Series) -> list[dict]:
    """Сделки по сменам цели. Позиция, уже открытая на первой свече ряда, не берётся: вход неизвестен."""
    tg = target.to_numpy()
    ts, op = df["ts"].to_numpy(), df["open"].to_numpy()
    hi, lo, cl = df["high"].to_numpy(), df["low"].to_numpy(), df["close"].to_numpy()
    n = len(df)
    trades: list[dict] = []
    entry_i: int | None = None

    def finish(i: int, j: int | None) -> dict:
        end = j if j is not None else n - 1
        price = float(cl[i])
        stop = atr_stop(price, float(band.iloc[i]), price, "long") if not math.isnan(band.iloc[i]) else None
        t: dict = {
            "entry_ts": int(ts[i]), "entry_price": price, "stop": stop,
            "target": round(price + TARGET_R * (price - stop), 8) if stop is not None else None,
            "entry_fill": float(op[i + 1]) if i + 1 < n else None,
            "exit_ts": int(ts[j]) if j is not None else None,
            "exit_price": float(cl[j]) if j is not None else None,
            "exit_fill": float(op[j + 1]) if j is not None and j + 1 < n else None,
            "open": j is None, "bars": end - i, "stop_hit_ts": None, "target_hit_ts": None,
            "pnl_stop_pct": None,
        }
        t["pnl_pct"] = _pnl(price, float(cl[end]))
        if stop is not None:
            for k in range(i + 1, end + 1):
                if lo[k] <= stop:
                    t["stop_hit_ts"] = int(ts[k])
                    # гэп вниз: исполнение по открытию, а не по уровню стопа
                    t["pnl_stop_pct"] = _pnl(price, min(float(op[k]), stop))
                    break
        if t["target"] is not None:
            for k in range(i + 1, end + 1):
                if hi[k] >= t["target"]:
                    t["target_hit_ts"] = int(ts[k])
                    break
        return t

    for i in range(1, n):
        if tg[i] == 1 and tg[i - 1] == 0:
            entry_i = i
        elif tg[i] == 0 and tg[i - 1] == 1 and entry_i is not None:
            trades.append(finish(entry_i, i))
            entry_i = None
    if entry_i is not None:
        trades.append(finish(entry_i, None))
    return trades


def trade_stats(trades: list[dict]) -> dict:
    done = [t for t in trades if not t["open"]]
    wins = [t for t in done if t["pnl_pct"] > 0]
    with_stop = [t["pnl_stop_pct"] if t["pnl_stop_pct"] is not None else t["pnl_pct"] for t in done]
    return {
        "trades": len(trades),
        "closed": len(done),
        "open": len(trades) - len(done),
        "win_rate": round(len(wins) / len(done) * 100, 1) if done else None,
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in done) / len(done), 2) if done else None,
        "avg_pnl_stop_pct": round(sum(with_stop) / len(done), 2) if done else None,
        "stop_hits": sum(1 for t in done if t["stop_hit_ts"] is not None),
        "gross": True,  # без комиссий и проскальзывания
    }


def _target_after(strat: Strategy, df: pd.DataFrame, params: dict[str, int], x: float) -> int:
    last = df.iloc[-1]
    row = pd.DataFrame(
        [(int(last["ts"]) + 1, float(last["close"]), max(float(last["close"]), x), min(float(last["close"]), x), x, 0.0)],
        columns=df.columns,
    )
    return int(strat.target(pd.concat([df, row], ignore_index=True), params).iloc[-1])


def find_trigger(strat: Strategy, df: pd.DataFrame, params: dict[str, int], current: int) -> dict | None:
    """Цена закрытия следующей свечи, при которой правило сменит позицию. Считается самой стратегией:
    подставляем пробную свечу и ищем ближайшую цену, где цель меняется (сетка + деление пополам)."""
    c = float(df["close"].iloc[-1])
    best: tuple[float, float, float] | None = None  # (расстояние, без смены, со сменой)
    for sign in (1, -1):
        prev = c
        for k in range(1, _GRID + 1):
            x = c * (1 + sign * TRIGGER_RANGE * (k / _GRID) ** 2)  # гуще у цены
            if x <= 0:
                break
            if _target_after(strat, df, params, x) != current:
                if best is None or abs(x - c) < best[0]:
                    best = (abs(x - c), prev, x)
                break
            prev = x
    if best is None:
        return None
    _, calm, flip = best
    for _ in range(_BISECT):
        mid = (calm + flip) / 2
        if _target_after(strat, df, params, mid) != current:
            flip = mid
        else:
            calm = mid
    level = round(flip, 8)
    return {
        "level": level,
        "distance_pct": round((level / c - 1) * 100, 2),
        "kind": "entry" if current == 0 else "exit",
        "direction": "above" if level > c else "below",
    }


def _points(series: pd.Series, ts: np.ndarray) -> list[list[float]]:
    out: list[list[float]] = []
    for t, v in zip(ts, series.to_numpy(), strict=True):
        f = _num(v)
        if f is not None:
            out.append([int(t), f])
    return out


def build_replay(df: pd.DataFrame, strat: Strategy, params: dict[str, int]) -> dict:
    target = strat.target(df, params)
    band = atr(df, 14)
    trades = build_trades(df, target, band)
    current = int(target.iloc[-1])
    ts = df["ts"].to_numpy()
    since_ts = int(ts[-1])
    for i in range(len(df) - 1, -1, -1):
        if int(target.iloc[i]) != current:
            break
        since_ts = int(ts[i])
    indicators = [
        {
            "id": ln["id"], "label": ln["label"], "pane": ln["pane"], "step": ln["step"],
            "levels": [{"value": v, "label": lab} for v, lab in ln["levels"]],
            "points": _points(ln["series"], ts),
        }
        for ln in strat.overlays(df, params)
    ]
    return {
        "strategy": strat.id,
        "strategy_name": strat.name,
        "params": params,
        "target": current,  # 1 — правило сейчас в позиции
        "since_ts": since_ts,
        "last_close": float(df["close"].iloc[-1]),
        "last_ts": int(ts[-1]),
        "trades": trades,
        "stats": trade_stats(trades),
        "indicators": indicators,
        "trigger": find_trigger(strat, df, params, current),
    }
