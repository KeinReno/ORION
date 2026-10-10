"""Свинговый план крипто-сигнала на изолированные 100 USDT.

Короткий стоп без плеча превращает 100 долларов в копейки: заметная сумма
появляется только на большом депозите. Здесь стоп ставится по волатильности
(2·ATR дневной свечи), а плечо подбирается так, чтобы эти 100 USDT при стопе
теряли около половины маржи (внутри 30–100%), а цель в три риска давала
примерно 150% (внутри 30–300%). Выше этих 100 USDT сделка не теряет: маржа изолированная.
Потолок плеча 200× — это высокий риск потери: короткое движение цены
против сделки может забрать всю маржу.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

STAKE_USDT = 100.0
STOP_ATR_MULT = 2.0
AIM_LOSS_PCT = 50.0
MIN_LOSS_PCT = 30.0
MAX_LOSS_PCT = 100.0
AIM_R = 3.0
MIN_PROFIT_PCT = 30.0
MAX_PROFIT_PCT = 300.0
MAX_LEVERAGE = 200.0
# Стоп шире 80% цены уже не свинг, а ставка на обвал. Дальше плечо только снижается.
MAX_STOP_PCT = 80.0


@dataclass(frozen=True, slots=True)
class SwingPlan:
    stop: float
    target: float
    leverage: float
    stake: float


def _fit(stop_pct: float) -> tuple[float, float, float]:
    """Плечо и ширина стопа так, чтобы потеря маржи была около 50% и внутри 30–100%."""
    stop_pct = min(stop_pct, MAX_STOP_PCT)
    leverage = AIM_LOSS_PCT / stop_pct
    leverage = min(leverage, MAX_LEVERAGE, MAX_LOSS_PCT / stop_pct)
    leverage = max(1.0, math.floor(leverage * 10 + 1e-9) / 10)
    if stop_pct * leverage > MAX_LOSS_PCT:
        leverage = max(1.0, math.floor(MAX_LOSS_PCT / stop_pct * 10 + 1e-9) / 10)
    # Тесный стоп даже на максимальном плече даёт меньше 30% маржи — отодвигаем стоп.
    if stop_pct * leverage < MIN_LOSS_PCT:
        stop_pct = MIN_LOSS_PCT / leverage
    loss_pct = stop_pct * leverage
    profit_pct = min(MAX_PROFIT_PCT, max(MIN_PROFIT_PCT, AIM_R * loss_pct))
    return leverage, stop_pct, profit_pct


def _short_target(price: float, leverage: float, profit_pct: float) -> tuple[float, float]:
    """Цель шорта остаётся выше нуля. Доля маржи держится внутри 30–300%."""
    if profit_pct / leverage >= 95:
        profit_pct = min(MAX_PROFIT_PCT, max(MIN_PROFIT_PCT, 95 * leverage))
    return round(price * (1 - profit_pct / leverage / 100), 8), profit_pct


def _refit_past_open(stop_pct: float) -> tuple[float, float, float]:
    """Стоп уже стоит по нужную сторону открытия и шире потолка 80%: плечо только снижаем."""
    leverage = min(AIM_LOSS_PCT / stop_pct, MAX_LEVERAGE, MAX_LOSS_PCT / stop_pct)
    leverage = max(1.0, math.floor(leverage * 10 + 1e-9) / 10)
    if stop_pct * leverage > MAX_LOSS_PCT:
        leverage = max(1.0, math.floor(MAX_LOSS_PCT / stop_pct * 10 + 1e-9) / 10)
    loss_pct = min(MAX_LOSS_PCT, stop_pct * leverage)
    profit_pct = min(MAX_PROFIT_PCT, max(MIN_PROFIT_PCT, AIM_R * loss_pct))
    return leverage, loss_pct, profit_pct


def swing_plan(
    price: float,
    atr: float,
    stake: float = STAKE_USDT,
    open_price: float | None = None,
    direction: str = "long",
) -> SwingPlan | None:
    """План сделки. Лонг — стоп ниже открытия, шорт — выше. None — цену или ATR нельзя использовать.

    Потеря при стопе остаётся около 30–100% изолированной маржи, цель — около 30–300%.
    """
    if not all(math.isfinite(x) for x in (price, atr, stake)) or price <= 0 or atr <= 0 or stake <= 0:
        return None
    short = direction == "short"
    anchor = open_price if open_price is not None and math.isfinite(open_price) and open_price > 0 else None
    if short:
        raw = (anchor if anchor is not None else price) + STOP_ATR_MULT * atr
        if raw <= price:
            return None
        stop_pct = (raw - price) / price * 100
    elif anchor is not None and anchor != price:
        raw = anchor - STOP_ATR_MULT * atr
        if raw <= 0 or raw >= price:
            return None
        stop_pct = (price - raw) / price * 100
    else:
        stop_pct = STOP_ATR_MULT * atr / price * 100
    if stop_pct <= 0:
        return None
    leverage, stop_pct, profit_pct = _fit(stop_pct)
    if short:
        stop = round(price * (1 + stop_pct / 100), 8)
        target, profit_pct = _short_target(price, leverage, profit_pct)
        if anchor is not None and stop <= anchor:
            stop = round(anchor + STOP_ATR_MULT * atr, 8)
            if stop <= price:
                return None
            leverage, loss_pct, profit_pct = _refit_past_open((stop - price) / price * 100)
            target, profit_pct = _short_target(price, leverage, profit_pct)
        if stop <= price or target <= 0 or target >= price:
            return None
    else:
        stop = round(price * (1 - stop_pct / 100), 8)
        target = round(price * (1 + profit_pct / leverage / 100), 8)
        if anchor is not None and not (0 < stop < anchor):
            stop = round(anchor - STOP_ATR_MULT * atr, 8)
            if stop <= 0 or stop >= price or stop >= anchor:
                return None
            leverage, _loss_pct, profit_pct = _refit_past_open((price - stop) / price * 100)
            target = round(price * (1 + profit_pct / leverage / 100), 8)
        if stop <= 0 or stop >= price or target <= price:
            return None
    return SwingPlan(stop=stop, target=target, leverage=leverage, stake=stake)


def outcome(
    price: float,
    stop: float | None,
    target: float | None,
    leverage: float | None,
    stake: float | None,
) -> dict | None:
    """Сколько 100 USDT заработают на цели и потеряют на стопе. None — плана нет."""
    if stop is None or target is None or leverage is None or stake is None:
        return None
    if not all(math.isfinite(x) for x in (price, stop, target, leverage, stake)):
        return None
    long = 0 < stop < price < target
    short = 0 < target < price < stop
    if price <= 0 or stake <= 0 or leverage <= 0 or not (long or short):
        return None
    if short:
        loss_usdt = stake * leverage * (stop - price) / price
        profit_usdt = stake * leverage * (price - target) / price
    else:
        loss_usdt = stake * leverage * (price - stop) / price
        profit_usdt = stake * leverage * (target - price) / price
    loss_usdt = min(stake, loss_usdt)
    profit_usdt = min(stake * MAX_PROFIT_PCT / 100, profit_usdt)
    return {
        "stake": stake,
        "leverage": leverage,
        "target": target,
        "notional": round(stake * leverage, 2),
        "qty": round(stake * leverage / price, 8),
        "loss_usdt": round(loss_usdt, 2),
        "profit_usdt": round(profit_usdt, 2),
        "loss_pct": round(loss_usdt / stake * 100, 1),
        "profit_pct": round(profit_usdt / stake * 100, 1),
        "risk_note": (
            f"Высокий риск потери. Плечо {leverage:g}×, потолок {MAX_LEVERAGE:.0f}×: "
            "небольшое движение цены против сделки может забрать всю маржу."
        ),
    }
