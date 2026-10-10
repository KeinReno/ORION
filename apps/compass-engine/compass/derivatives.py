"""Спот против бессрочных фьючерсов: базис, funding, открытый интерес, кто ведёт.

Это сравнение структуры рынка, а не сигнал: композит спота и перпетива — та же
медиана площадок, базис — разница между ними. Константы порогов возвращаются в
ответе API, чтобы интерфейс не подавал их как истину. Годовой funding — грубая
оценка: период 8 часов принят одинаковым для всех бирж. Контрактные количества
открытого интереса разных бирж не складываются — разные размеры контрактов.
"""

from __future__ import annotations

from statistics import median

BASIS_FLAT_PCT = 0.05  # |базис| до 0.05% — флэт, а не контанго/бэквордация
LEAD_MIN_PP = 0.2  # разница суточных ходов, п.п., чтобы площадка отдала голос
MIN_LEAD_VENUES = 2  # меньше двух площадок с данными — не классифицируем
FUNDING_PERIODS_PER_YEAR = 3 * 365  # 8-часовых периодов в году


def basis_state(pct: float | None) -> str | None:
    """Состояние базиса: перпетив дороже спота — contango, дешевле — backwardation."""
    if pct is None:
        return None
    if abs(pct) <= BASIS_FLAT_PCT:
        return "flat"
    return "contango" if pct > 0 else "backwardation"


def funding_summary(rates: dict[str, float | None]) -> dict:
    """Медиана funding по площадкам и грубая годовая оценка.

    `rates` — биржа → ставка за период (доля, не процент). Пустые площадки не
    участвуют. Без данных — честные None, а не ноль.
    """
    live = {x: r for x, r in rates.items() if r is not None}
    out: dict = {
        "count": len(live),
        "positive": sum(1 for r in live.values() if r > 0),
        "negative": sum(1 for r in live.values() if r < 0),
        "median_pct": None,
        "annualized_pct": None,
    }
    if not live:
        return out
    m = float(median(live.values()))
    out["median_pct"] = round(m * 100, 5)
    out["annualized_pct"] = round(m * 100 * FUNDING_PERIODS_PER_YEAR, 2)
    return out


def open_interest_summary(rows: list[dict]) -> dict:
    """Суммарный интерес только по площадкам с оценкой в долларах.

    `amount_only` — площадки, отдавшие лишь количество контрактов: они честно
    перечислены, но в сумму не входят.
    """
    total, value_venues, amount_only = 0.0, [], []
    for r in rows:
        v = r.get("oi_value_usd")
        if v is not None:
            total += v
            value_venues.append(r["exchange"])
        elif r.get("oi_amount") is not None:
            amount_only.append(r["exchange"])
    return {
        "total_usd": None if not value_venues else round(total, 2),
        "venues_in_total": sorted(value_venues),
        "amount_only": sorted(amount_only),
    }


def leadership(spot: dict[str, float | None], perp: dict[str, float | None]) -> dict:
    """Кто сильнее сдвинулся за сутки: спот или перпетив.

    Голос площадки — только там, где есть оба хода: перп опередил спот на
    LEAD_MIN_PP п.п. — голос за деривативы, отстал на столько же — за спот,
    промежуточная разница — воздержался. Меньше MIN_LEAD_VENUES площадок с
    данными — `unclear`: не на чем классифицировать.
    """
    deltas = {
        x: perp[x] - spot[x]
        for x in spot
        if x in perp and spot.get(x) is not None and perp.get(x) is not None
    }
    spot_votes = sum(1 for d in deltas.values() if d <= -LEAD_MIN_PP)
    perp_votes = sum(1 for d in deltas.values() if d >= LEAD_MIN_PP)
    if len(deltas) < MIN_LEAD_VENUES:
        state = "unclear"
    elif perp_votes > spot_votes:
        state = "derivatives_led"
    elif spot_votes > perp_votes:
        state = "spot_led"
    else:
        state = "mixed"
    return {
        "state": state,
        "spot_median_pct": None if not deltas else round(median(spot[x] for x in deltas), 2),
        "perp_median_pct": None if not deltas else round(median(perp[x] for x in deltas), 2),
        "counted": len(deltas),
        "spot_votes": spot_votes,
        "perp_votes": perp_votes,
    }
