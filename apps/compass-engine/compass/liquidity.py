"""Ликвидность стакана: спред, глубина на стандартных полосах, дисбаланс,
оценка исполнения заданной суммы.

Это оценка по снимку стакана, а не гарантия цены: между запросом и заявкой
стакан меняется, очередь заявок и скрытая ликвидность не видны. Глубина
считается в стоимости котировки (цена × количество): сырые количества и
размеры контрактов площадок напрямую несравнимы. Полосы глубины и комиссия —
константы приложения (реальные тарифы бирж различаются); обе возвращаются в
ответе API, чтобы интерфейс не подавал их как истину.
"""

from __future__ import annotations

from collections.abc import Sequence

from compass.crypto_tools import TAKER_FEE_PCT

DEPTH_BANDS_PCT = (0.1, 0.5, 1.0)  # полосы вокруг середины для сравнения ликвидности


def _levels(side: Sequence | None) -> list[tuple[float, float]]:
    """Сторона стакана → пары (цена, количество) без нулей и мусора."""
    out: list[tuple[float, float]] = []
    for row in side or []:
        try:
            price, amount = float(row[0]), float(row[1])
        except (TypeError, ValueError, IndexError):
            continue
        if price > 0 and amount > 0:
            out.append((price, amount))
    return out


def mid_price(bid: float | None, ask: float | None) -> float | None:
    """Середина между лучшими bid и ask. Перекрёстный или пустой стакан — None."""
    if bid is None or ask is None or bid <= 0 or ask < bid:
        return None
    return (bid + ask) / 2


def spread_pct(bid: float | None, ask: float | None) -> float | None:
    """Спред лучших заявок в % от середины."""
    mid = mid_price(bid, ask)
    if mid is None or mid <= 0:
        return None
    return round((ask - bid) / mid * 100, 4)


def band_depth(
    bids: Sequence, asks: Sequence, mid: float, band_pct: float
) -> dict[str, float]:
    """Стоимость котировки в полосе ±band_pct вокруг середины, по сторонам, $."""
    lo, hi = mid * (1 - band_pct / 100), mid * (1 + band_pct / 100)
    bid_usd = sum(p * a for p, a in _levels(bids) if p >= lo)
    ask_usd = sum(p * a for p, a in _levels(asks) if p <= hi)
    return {"bid_usd": round(bid_usd, 2), "ask_usd": round(ask_usd, 2)}


def imbalance(bid_usd: float, ask_usd: float) -> float | None:
    """Перевес глубины: +1 — только заявки на покупку, −1 — только на продажу."""
    total = bid_usd + ask_usd
    if total <= 0:
        return None
    return round((bid_usd - ask_usd) / total, 3)


def book_fill(levels: Sequence, notional: float, side: str) -> dict | None:
    """Проход по стороне стакана на заданную сумму.

    `levels` — заявки одной стороны; порядок перепроверяется (asks по
    возрастанию, bids по убыванию): перепутанная сторона дала бы красивую, но
    неверную среднюю. `partial` — стакан тоньше суммы: числа только по
    набранной части, а не догадка о недостающем.
    """
    rows = _levels(levels)
    if not rows or notional <= 0:
        return None
    rows.sort(key=lambda x: x[0], reverse=(side == "sell"))
    filled_amount, filled_value = 0.0, 0.0
    for price, amount in rows:
        take = min(notional - filled_value, price * amount)
        if take <= 0:
            break
        filled_amount += take / price
        filled_value += take
        if filled_value >= notional - 1e-9:
            break
    return {
        "vwap": round(filled_value / filled_amount, 10),
        "filled_usd": round(filled_value, 2),
        "partial": filled_value < notional - 1e-6,
    }


def _side_cost(fill: dict | None, mid: float, fee_pct: float, side: str) -> dict | None:
    """Проход по стакану → средняя цена и «всё против середины», %."""
    if fill is None:
        return None
    vwap = fill["vwap"]
    price_pct = (vwap / mid - 1) * 100
    if side == "buy":
        cost_pct = (vwap * (1 + fee_pct / 100) / mid - 1) * 100
    else:
        cost_pct = (1 - vwap * (1 - fee_pct / 100) / mid) * 100
    return {**fill, "price_pct": round(price_pct, 4), "cost_pct": round(cost_pct, 4)}


def liquidity_snapshot(book: dict, notional: float, fee_pct: float = TAKER_FEE_PCT) -> dict | None:
    """Снимок ликвидности площадки: середина, спред, полосы глубины, исполнение.

    `cost_pct` — всё против середины: смещение средней цены плюс комиссия.
    Стакан пуст или перекрёстен — None: числа не выдумываем.
    """
    bids, asks = _levels(book.get("bids")), _levels(book.get("asks"))
    if not bids or not asks:
        return None
    bid, ask = max(p for p, _ in bids), min(p for p, _ in asks)
    mid = mid_price(bid, ask)
    if mid is None:
        return None
    depth = []
    for band in DEPTH_BANDS_PCT:
        d = band_depth(bids, asks, mid, band)
        depth.append({"band_pct": band, **d, "imbalance": imbalance(d["bid_usd"], d["ask_usd"])})
    return {
        "mid": round(mid, 10),
        "spread_pct": spread_pct(bid, ask),
        "depth": depth,
        "buy": _side_cost(book_fill(asks, notional, "buy"), mid, fee_pct, "buy"),
        "sell": _side_cost(book_fill(bids, notional, "sell"), mid, fee_pct, "sell"),
    }


def best_execution(readings: dict[str, dict], side: str) -> dict | None:
    """Площадка с наименьшей all-in стоимостью по стороне.

    Площадка, не набравшая всю сумму (`partial`), в «лучшие» не попадает: её
    средняя — по обрезанной части, сравнение с полными наборами нечестное.
    """
    eligible = [
        (x, r[side])
        for x, r in readings.items()
        if r.get(side) is not None and not r[side]["partial"]
    ]
    if not eligible:
        return None
    x, fill = min(eligible, key=lambda t: (t[1]["cost_pct"], t[0]))
    return {
        "exchange": x,
        "cost_pct": fill["cost_pct"],
        "vwap": fill["vwap"],
        "price_pct": fill["price_pct"],
    }
