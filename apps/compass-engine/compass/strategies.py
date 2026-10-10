"""Стратегии. Только long/flat — и на акциях МосБиржи, и на крипто-споте
обычный частный трейдер не шортит, поэтому «короткой» позиции в модели нет.

Стратегия отвечает на один вопрос: «на закрытии свечи i я хочу быть в позиции
(1) или вне (0)?». Исполнение (по открытию следующей свечи), комиссии и
проскальзывание — дело бэктестера, не стратегии.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from compass.indicators import rsi, sma


@dataclass(frozen=True, slots=True)
class Param:
    name: str
    label: str
    default: int
    min: int
    max: int
    optional: bool = False  # 0 — «выключено»: такое значение не меняет идентификатор версии стратегии


@dataclass(frozen=True, slots=True)
class Strategy:
    id: str
    name: str
    description: str  # для новичка, по-русски
    params: tuple[Param, ...]
    target: Callable[[pd.DataFrame, dict[str, int]], pd.Series]
    check: Callable[[dict[str, int]], str | None] = lambda p: None  # ошибка сочетания параметров
    version: int = 1  # номер редакции правила: увеличивать при любом изменении логики target()
    # линии для графика: что именно видит правило. Не влияет на сигналы и версию стратегии.
    overlays: Callable[[pd.DataFrame, dict[str, int]], list[dict]] = lambda df, p: []
    # предупреждение по рынку (id рынка → текст), если проверка на истории показала слабое место правила
    market_notes: dict[str, str] = field(default_factory=dict)

    def resolve(self, overrides: dict[str, int] | None = None) -> dict[str, int]:
        """Дефолты + значения пользователя с проверкой границ. ValueError — по-русски."""
        overrides = overrides or {}
        known = {p.name for p in self.params}
        extra = set(overrides) - known
        if extra:
            raise ValueError(f"Неизвестные параметры: {', '.join(sorted(extra))}")
        out: dict[str, int] = {}
        for p in self.params:
            v = overrides.get(p.name, p.default)
            if isinstance(v, bool) or not isinstance(v, int):
                # ValueError, не TypeError: API отдаёт его как 422 с понятным текстом
                raise ValueError(f"Параметр «{p.label}» должен быть целым числом")  # noqa: TRY004
            if not p.min <= v <= p.max:
                raise ValueError(f"Параметр «{p.label}» должен быть от {p.min} до {p.max}")
            if p.optional and v == 0:
                continue  # выключенный необязательный параметр не хранится: набор параметров остаётся прежним
            out[p.name] = v
        problem = self.check(out)
        if problem:
            raise ValueError(problem)
        return out


def _trend_ok(df: pd.DataFrame, n: int) -> np.ndarray:
    """Фильтр тренда: закрытие выше SMA(n). n = 0 — фильтр выключен. В прогреве SMA фильтр не пропускает."""
    if n <= 0:
        return np.ones(len(df), dtype=bool)
    line = sma(df["close"], n)
    return (df["close"] > line).to_numpy() & line.notna().to_numpy()


def _sma_cross(df: pd.DataFrame, p: dict[str, int]) -> pd.Series:
    fast, slow = sma(df["close"], p["fast"]), sma(df["close"], p["slow"])
    base = (fast > slow).astype(int)  # NaN в прогреве даёт False → 0
    if not p.get("trend"):
        return base
    # фильтр действует только на вход: открытая позиция живёт до обратного пересечения
    ok, b = _trend_ok(df, p["trend"]), base.to_numpy()
    out = np.zeros(len(b), dtype=int)
    held = 0
    for i in range(len(b)):
        if b[i] == 0:
            held = 0
        elif held == 0 and i > 0 and b[i - 1] == 0 and ok[i]:
            held = 1
        out[i] = held
    return pd.Series(out, index=df.index)


def _rsi_reversion(df: pd.DataFrame, p: dict[str, int]) -> pd.Series:
    r = rsi(df["close"], p["period"]).to_numpy()
    out = np.zeros(len(r), dtype=int)
    held = 0
    for i, v in enumerate(r):
        if np.isnan(v):
            held = 0
        elif held == 0 and v < p["buy_below"]:
            held = 1
        elif held == 1 and v > p["exit_above"]:
            held = 0
        out[i] = held
    return pd.Series(out, index=df.index)


def _donchian(df: pd.DataFrame, p: dict[str, int]) -> pd.Series:
    # уровни считаются по ПРЕДЫДУЩИМ свечам (shift) — иначе свеча сравнивается сама с собой
    upper = df["high"].rolling(p["entry"]).max().shift(1)
    lower = df["low"].rolling(p["exit"]).min().shift(1)
    close = df["close"].to_numpy()
    up, lo = upper.to_numpy(), lower.to_numpy()
    ok = _trend_ok(df, p.get("trend", 0))
    out = np.zeros(len(df), dtype=int)
    held = 0
    for i in range(len(df)):
        if np.isnan(up[i]) or np.isnan(lo[i]):
            held = 0
        elif held == 0 and close[i] > up[i] and ok[i]:
            held = 1
        elif held == 1 and close[i] < lo[i]:
            held = 0
        out[i] = held
    return pd.Series(out, index=df.index)


def _line(id_: str, label: str, series: pd.Series, *, pane: str = "price", step: bool = False,
          levels: tuple[tuple[float, str], ...] = ()) -> dict:
    return {"id": id_, "label": label, "pane": pane, "step": step, "series": series, "levels": levels}


def _trend_line(df: pd.DataFrame, p: dict[str, int]) -> list[dict]:
    return [_line("trend", f"Фильтр SMA {p['trend']}", sma(df["close"], p["trend"]))] if p.get("trend") else []


def _sma_overlays(df: pd.DataFrame, p: dict[str, int]) -> list[dict]:
    return [
        _line("fast", f"SMA {p['fast']}", sma(df["close"], p["fast"])),
        _line("slow", f"SMA {p['slow']}", sma(df["close"], p["slow"])),
        *_trend_line(df, p),
    ]


def _rsi_overlays(df: pd.DataFrame, p: dict[str, int]) -> list[dict]:
    return [_line("rsi", f"RSI {p['period']}", rsi(df["close"], p["period"]), pane="osc",
                  levels=((float(p["buy_below"]), "вход"), (float(p["exit_above"]), "выход")))]


def _donchian_overlays(df: pd.DataFrame, p: dict[str, int]) -> list[dict]:
    return [
        _line("upper", f"Канал входа {p['entry']}", df["high"].rolling(p["entry"]).max().shift(1), step=True),
        _line("lower", f"Канал выхода {p['exit']}", df["low"].rolling(p["exit"]).min().shift(1), step=True),
        *_trend_line(df, p),
    ]


STRATEGIES: dict[str, Strategy] = {
    s.id: s
    for s in (
        Strategy(
            id="sma_cross",
            name="Пересечение скользящих средних",
            description=(
                "Покупаем, когда быстрая средняя цена поднялась выше медленной (тренд вверх), "
                "выходим, когда упала ниже. Работает на трендах, в боковике даёт ложные входы."
            ),
            params=(
                Param("fast", "Быстрая средняя (свечей)", 20, 2, 200),
                Param("slow", "Медленная средняя (свечей)", 50, 3, 400),
                Param("trend", "Фильтр тренда: вход только выше SMA (0 — выключен)", 0, 0, 250, optional=True),
            ),
            target=_sma_cross,
            overlays=_sma_overlays,
            check=lambda p: None if p["fast"] < p["slow"] else "Быстрая средняя должна быть короче медленной",
        ),
        Strategy(
            id="rsi_reversion",
            name="RSI: покупка после перепроданности",
            description=(
                "RSI показывает, насколько резко цена падала или росла. Покупаем, когда RSI "
                "опустился ниже порога (цену слишком сильно продали), выходим, когда RSI "
                "вернулся выше порога выхода. Хорошо в боковике, плохо в сильном падении."
            ),
            params=(
                Param("period", "Период RSI", 14, 2, 100),
                Param("buy_below", "Покупать, если RSI ниже", 30, 5, 50),
                Param("exit_above", "Выходить, если RSI выше", 50, 30, 90),
            ),
            target=_rsi_reversion,
            overlays=_rsi_overlays,
            market_notes={
                "moex": (
                    "На акциях МосБиржи за ~10 лет (2500 свечей, 1d) средняя сделка этого правила в минусе: "
                    "около −0,4% после комиссий, на последних 40% истории около −1,5%. Как самостоятельный сигнал "
                    "для акций не подходит; для трендовых стратегий проверка была лучше."
                ),
                "crypto": "На крипте (4h) средняя сделка около нуля: комиссия съедает преимущество.",
            },
            check=lambda p: None if p["buy_below"] < p["exit_above"] else "Порог входа должен быть ниже порога выхода",
        ),
        Strategy(
            id="donchian",
            name="Пробой канала Дончиана",
            description=(
                "Покупаем, когда цена закрылась выше максимума предыдущих N свечей "
                "(текущая свеча в свой канал не входит), выходим, когда закрылась ниже минимума "
                "предыдущих M свечей. Ловит начало сильных движений, но часто входит на ложных пробоях."
            ),
            params=(
                Param("entry", "Канал входа (свечей)", 20, 2, 300),
                Param("exit", "Канал выхода (свечей)", 10, 2, 300),
                Param("trend", "Фильтр тренда: вход только выше SMA (0 — выключен)", 0, 0, 250, optional=True),
            ),
            target=_donchian,
            overlays=_donchian_overlays,
        ),
    )
}


def canonical_params(strat: Strategy, params: dict[str, int] | None) -> dict[str, int] | None:
    """Параметры без выключенных необязательных: так сигналы, записанные до появления параметра, остаются теми же."""
    if params is None:
        return None
    off = {p.name for p in strat.params if p.optional}
    return {k: v for k, v in params.items() if not (k in off and v == 0)}


def strategy_version(strat: Strategy, params: dict[str, int]) -> str:
    """Идентификатор конкретной конфигурации: правило + его редакция + параметры.
    Совпадает у бэктеста, сигнала и плана, поэтому видно, что проверено именно то, что торгуется."""
    canon = json.dumps(canonical_params(strat, params), sort_keys=True, separators=(",", ":"))
    return f"{strat.id}/r{strat.version}/{hashlib.sha256(canon.encode()).hexdigest()[:8]}"


def candles_to_df(candles) -> pd.DataFrame:
    df = pd.DataFrame(
        [(c.ts, c.open, c.high, c.low, c.close, c.volume) for c in candles],
        columns=["ts", "open", "high", "low", "close", "volume"],
    )
    return df.reset_index(drop=True)
