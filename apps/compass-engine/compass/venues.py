"""Кросс-биржевой консенсус: композитная цена и согласие площадок.

Композит — медиана котировок, а не среднее: одна залипшая или ошибочная цена
не сдвигает медиану, а расширяет дисперсию — это видно отдельно. Пороги —
константы приложения, а не оценка рынка: они возвращаются в ответе, чтобы
интерфейс не подавал их как истину. Перцентиль расхождения считается только
по накопленной истории биржи; мало истории — честное None.
"""

from __future__ import annotations

from collections.abc import Sequence
from statistics import median

from compass.models import Candle

TIGHT_PCT = 0.5  # |премия| до 0.5% — площадка согласна с композитом
OUTLIER_PCT = 1.0  # премия от 1% при согласии остальных — похоже на сбой источника
BAD_DISPERSION_PCT = 1.0  # дисперсия, при которой сила консенсуса обнуляется
MIN_HISTORY = 30  # меньше общих закрытых свечей — перцентиль не выдумываем


def consensus(quotes: dict[str, float | None]) -> dict:
    """Композит, премии площадок и состояние согласия по последним ценам.

    `quotes`: биржа → last (None — биржа не дала цену). Меньше двух живых
    котировок — консенсуса нет: состояние `insufficient` без выдуманного числа.
    Состояния: consensus (все в пределах tight), venue_specific (площадки
    честно разошлись), source_suspect (одна в стороне при согласии остальных).
    """
    valid = {x: p for x, p in quotes.items() if p is not None and p > 0}
    if len(valid) < 2:
        return {
            "composite": None,
            "premiums": {x: None for x in quotes},
            "dispersion_pct": None,
            "agree": [],
            "strength": None,
            "label": None,
            "state": "insufficient",
            "suspect": None,
        }
    composite = float(median(valid.values()))
    premiums = {
        x: (None if p is None or p <= 0 else round((p - composite) / composite * 100, 4))
        for x, p in quotes.items()
    }
    dispersion = (max(valid.values()) - min(valid.values())) / composite * 100
    agree = sorted(x for x, prem in premiums.items() if prem is not None and abs(prem) <= TIGHT_PCT)
    worst = max(valid, key=lambda x: abs(premiums[x] or 0.0))
    worst_prem = abs(premiums[worst] or 0.0)
    others_close = all(abs(premiums[x] or 0.0) <= TIGHT_PCT for x in valid if x != worst)
    if dispersion <= TIGHT_PCT:
        state, suspect = "consensus", None
    elif len(valid) >= 3 and worst_prem >= OUTLIER_PCT and others_close:
        # Двух площадок мало, чтобы решить, чей источник врёт: не обвиняем никого.
        state, suspect = "source_suspect", worst
    else:
        state, suspect = "venue_specific", None
    strength = round(1 - min(1.0, dispersion / BAD_DISPERSION_PCT), 2)
    label = "strong" if strength >= 0.7 else "medium" if strength >= 0.4 else "weak"
    return {
        "composite": composite,
        "premiums": premiums,
        "dispersion_pct": dispersion,
        "agree": agree,
        "strength": strength,
        "label": label,
        "state": state,
        "suspect": suspect,
    }


def percentile_rank(value: float | None, history: Sequence[float]) -> float | None:
    """Доля истории не больше значения, %. Мало данных — None, а не «серединка»."""
    if value is None or len(history) < MIN_HISTORY:
        return None
    below = sum(1 for x in history if x <= value)
    return round(below / len(history) * 100, 1)


def divergence_history(primary: Sequence[Candle], venue: Sequence[Candle]) -> list[float]:
    """Модуль расхождения закрытий по общим меткам времени, % от цены основной."""
    other = {c.ts: c.close for c in venue}
    out: list[float] = []
    for c in primary:
        v = other.get(c.ts)
        if v is not None and c.close > 0:
            out.append(abs(v - c.close) / c.close * 100)
    return out
