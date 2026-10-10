"""Крипто-маршруты: справка по монете, DCA, курс рубля, налоговая выгрузка FIFO,
сравнение бирж, консенсус (композит, премии, перцентиль расхождения), спот с
перпетивами, ликвидность стакана, lead/lag площадок и разбор событий.

Оповещения о цене живут в alerts.py — здесь их не дублируем.
"""

from __future__ import annotations

import csv
import io
import time
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TYPE_CHECKING, Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from compass.crypto_tools import (
    EDUCATION,
    TAKER_FEE_PCT,
    btc_link_note,
    btc_regime,
    coin_profile,
    correlation,
    dca_plan,
    fee_in_quote,
    fifo_report,
    parse_cbr_usd,
    quote_warning,
    rub_per_usdt,
)
from compass.derivatives import (
    BASIS_FLAT_PCT,
    LEAD_MIN_PP,
    basis_state,
    funding_summary,
    leadership,
    open_interest_summary,
)
from compass.leadlag import (
    LEAD_SHARE_MIN,
    MAX_LAG,
    MIN_BARS,
    MIN_LEAD_VOTES,
    STABLE_THIRDS_MIN,
    T_MIN,
    analyze,
)
from compass.liquidity import DEPTH_BANDS_PCT, best_execution, liquidity_snapshot
from compass.market_events import (
    EVENT_DISPERSION_MIN_PCT,
    EVENT_DISPERSION_MULT,
    EVENT_MOVE_MIN_PCT,
    EVENT_MOVE_MULT,
    MAX_EVENTS,
    MIN_COMPOSITE_VENUES,
    composite_rows,
    detect_events,
    with_windows,
)
from compass.market_events import MIN_BARS as EVENTS_MIN_BARS
from compass.markets.base import MarketError
from compass.markets.crypto import CRYPTO_EXCHANGES, DERIVATIVES_EXCHANGES, price_gap
from compass.models import TIMEFRAME_MS, Candle, closed_candles
from compass.venues import (
    BAD_DISPERSION_PCT,
    OUTLIER_PCT,
    TIGHT_PCT,
    consensus,
    divergence_history,
    percentile_rank,
)

if TYPE_CHECKING:
    from compass.api.app import Services

_CBR = "https://www.cbr-xml-daily.ru/daily_json.js"
_rub_cache: dict[str, Any] = {}


class DcaRequest(BaseModel):
    budget: float = Field(gt=0)
    parts: int = Field(ge=2, le=365)
    fee_pct: float = Field(TAKER_FEE_PCT, ge=0, lt=100)
    prices: list[float] | None = None


class FeeCoinRequest(BaseModel):
    fee_coin: float = Field(ge=0)
    price: float = Field(gt=0)


def register_crypto_routes(app: FastAPI, svc: Services) -> None:
    consensus_cache: dict[str, dict[str, Any]] = {}  # ключ биржа:символ → {at, data}
    derivatives_cache: dict[str, dict[str, Any]] = {}  # то же для спота с перпетивами
    liquidity_cache: dict[str, dict[str, Any]] = {}  # то же для стакана, ключ включает сумму
    leadlag_cache: dict[str, dict[str, Any]] = {}  # то же для lead/lag, ключ включает окно
    events_cache: dict[str, dict[str, Any]] = {}  # то же для разбора событий, ключ включает окно
    consensus_ttl_s = 60  # шесть бирж чаще раза в минуту опрашивать незачем
    liquidity_ttl_s = 15  # стакан живёт секундами — кэш короче, чем у композита
    leadlag_ttl_s = 120  # окно свечей меняется медленно — редкий пересчёт не вредит
    events_ttl_s = 120  # события историчны: между пересчётами меняется максимум последний бар

    @app.get("/api/crypto/exchanges")
    def exchanges() -> dict:
        a = svc.adapters.get("crypto")
        return {
            "options": list(CRYPTO_EXCHANGES),
            "active": getattr(a, "exchange_id", None),
            "fallback": getattr(a, "fallback_id", None),
            "live_stream": getattr(a, "exchange_id", None) == "okx" and svc.live is not None,
            "note": "Живой поток свечей есть только у OKX. Остальные биржи, включая MEXC, обновляются опросом. Только спот.",
        }

    @app.get("/api/crypto/compare")
    def compare(
        symbol: str,
        venue: str,
        tf: str = "1h",
        limit: int = Query(500, ge=1, le=2000),
    ) -> dict:
        """Свечи и котировка второй биржи поверх основной. В кэш графика не пишется."""
        a = svc.adapters.get("crypto")
        if a is None:
            raise HTTPException(404, "Крипторынок не подключён")
        primary_id = getattr(a, "exchange_id", None)
        if venue == primary_id:
            raise HTTPException(400, "Вторая биржа должна отличаться от основной")
        try:
            rows = a.fetch_venue(venue, symbol, tf, limit)
        except MarketError as e:
            raise HTTPException(502, str(e)) from e
        primary_q = _ticker(a, primary_id, symbol)
        venue_q = _ticker(a, venue, symbol)
        gap = price_gap(primary_q["last"], venue_q["last"])
        percentile, bars = _gap_percentile(symbol, tf, limit, rows, gap)
        return {
            "symbol": symbol,
            "tf": tf,
            "primary": {"exchange": primary_id, **primary_q},
            "venue": {
                "exchange": venue,
                **venue_q,
                "candles": [
                    {"t": c.ts, "o": c.open, "h": c.high, "l": c.low, "c": c.close, "v": c.volume}
                    for c in rows
                ],
            },
            "divergence_abs": None if gap is None else gap["abs"],
            "divergence_pct": None if gap is None else gap["pct"],
            "divergence_percentile": percentile,
            "divergence_bars": bars,
        }

    @app.get("/api/crypto/consensus")
    def consensus_route(symbol: str) -> dict:
        """Композит по всем площадкам. Недоступная биржа не роняет расчёт — видна в sources."""
        a = svc.adapters.get("crypto")
        if a is None:
            raise HTTPException(404, "Крипторынок не подключён")
        key = f"{getattr(a, 'exchange_id', '?')}:{symbol}"
        now = time.time()
        hit = consensus_cache.get(key)
        if hit is not None and now - hit["at"] < consensus_ttl_s:
            return hit["data"]
        quotes: dict[str, dict[str, float | None]] = {}
        errors: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=len(CRYPTO_EXCHANGES)) as pool:
            futures = {pool.submit(a.quote, x, symbol): x for x in CRYPTO_EXCHANGES}
            for fut in as_completed(futures):
                venue_id = futures[fut]
                try:
                    quotes[venue_id] = fut.result()
                except MarketError as e:
                    errors[venue_id] = str(e)
        calc = consensus({x: (quotes.get(x) or {}).get("last") for x in CRYPTO_EXCHANGES})
        data = {
            "symbol": symbol,
            "checked_at": svc.now_ms(),
            "composite": calc["composite"],
            "state": calc["state"],
            "label": calc["label"],
            "strength": calc["strength"],
            "dispersion_pct": calc["dispersion_pct"],
            "agree": calc["agree"],
            "suspect": calc["suspect"],
            "venues_ok": len(quotes),
            "thresholds": {
                "tight_pct": TIGHT_PCT,
                "outlier_pct": OUTLIER_PCT,
                "bad_dispersion_pct": BAD_DISPERSION_PCT,
            },
            "sources": [
                {
                    "exchange": x,
                    "last": (quotes.get(x) or {}).get("last"),
                    "bid": (quotes.get(x) or {}).get("bid"),
                    "ask": (quotes.get(x) or {}).get("ask"),
                    "premium_pct": calc["premiums"].get(x),
                    "error": errors.get(x),
                }
                for x in CRYPTO_EXCHANGES
            ],
            "note": (
                "Композит — медиана последних цен площадок. Расхождение площадок — наблюдение "
                "о рынке, а не сигнал покупать или продавать. Пороги — константы приложения."
            ),
        }
        consensus_cache[key] = {"at": now, "data": data}
        return data

    @app.get("/api/crypto/derivatives")
    def derivatives_route(symbol: str) -> dict:
        """Спот и перпетивы площадок: базис, funding, открытый интерес.

        Секции площадки независимы — недоступная биржа видна в sources с
        причиной, остальные считаются. Все поля — снимок, без истории.
        """
        a = svc.adapters.get("crypto")
        if a is None:
            raise HTTPException(404, "Крипторынок не подключён")
        key = f"{getattr(a, 'exchange_id', '?')}:{symbol}"
        now = time.time()
        hit = derivatives_cache.get(key)
        if hit is not None and now - hit["at"] < consensus_ttl_s:
            return hit["data"]
        rows: dict[str, dict[str, Any]] = {}
        errors: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=len(DERIVATIVES_EXCHANGES)) as pool:
            futures = {pool.submit(a.derivative, x, symbol): x for x in DERIVATIVES_EXCHANGES}
            for fut in as_completed(futures):
                venue_id = futures[fut]
                try:
                    rows[venue_id] = fut.result()
                except MarketError as e:
                    errors[venue_id] = str(e)

        def _field(x: str, name: str) -> Any:
            return (rows.get(x) or {}).get(name)

        def _basis(x: str) -> float | None:
            g = price_gap(_field(x, "spot_last"), _field(x, "perp_last"))
            return None if g is None else round(g["pct"], 4)

        spot_calc = consensus({x: _field(x, "spot_last") for x in DERIVATIVES_EXCHANGES})
        perp_calc = consensus({x: _field(x, "perp_last") for x in DERIVATIVES_EXCHANGES})
        gap = price_gap(spot_calc["composite"], perp_calc["composite"])
        basis_pct = None if gap is None else round(gap["pct"], 4)
        data = {
            "symbol": symbol,
            "checked_at": svc.now_ms(),
            "spot_composite": spot_calc["composite"],
            "spot_state": spot_calc["state"],
            "perp_composite": perp_calc["composite"],
            "perp_state": perp_calc["state"],
            "basis_pct": basis_pct,
            "basis_state": basis_state(basis_pct),
            "funding": funding_summary(
                {x: _field(x, "funding_rate") for x in DERIVATIVES_EXCHANGES}
            ),
            "oi": open_interest_summary(
                [
                    {
                        "exchange": x,
                        "oi_amount": _field(x, "oi_amount"),
                        "oi_value_usd": _field(x, "oi_value_usd"),
                    }
                    for x in DERIVATIVES_EXCHANGES
                ]
            ),
            "leadership": leadership(
                {x: _field(x, "spot_change_24h_pct") for x in DERIVATIVES_EXCHANGES},
                {x: _field(x, "perp_change_24h_pct") for x in DERIVATIVES_EXCHANGES},
            ),
            "venues_ok": sum(
                1
                for x in DERIVATIVES_EXCHANGES
                if _field(x, "spot_last") is not None or _field(x, "perp_last") is not None
            ),
            "thresholds": {"basis_flat_pct": BASIS_FLAT_PCT, "lead_min_pp": LEAD_MIN_PP},
            "sources": [
                {
                    "exchange": x,
                    "spot_last": _field(x, "spot_last"),
                    "spot_change_24h_pct": _field(x, "spot_change_24h_pct"),
                    "perp_last": _field(x, "perp_last"),
                    "perp_change_24h_pct": _field(x, "perp_change_24h_pct"),
                    "basis_pct": _basis(x),
                    "funding_rate": _field(x, "funding_rate"),
                    "funding_next_ms": _field(x, "funding_next_ms"),
                    "oi_amount": _field(x, "oi_amount"),
                    "oi_value_usd": _field(x, "oi_value_usd"),
                    "field_errors": _field(x, "field_errors") or {},
                    "error": errors.get(x),
                }
                for x in DERIVATIVES_EXCHANGES
            ],
            "limitations": [
                (
                    "KuCoin не участвует: его перпетив живёт в отдельном API "
                    "(kucoinfutures) и в этот срез не подключён."
                ),
                (
                    "Годовая ставка funding — оценка по периодам 8 часов; часть бирж "
                    "меняет период, точность не гарантирована."
                ),
                (
                    "Открытый интерес суммируется только там, где биржа дала оценку "
                    "в долларах: контрактные количества разных бирж не складываются."
                ),
                (
                    "Funding и открытый интерес — снимок на момент запроса, без "
                    "истории: динамику по ним не построить."
                ),
                "«Ведёт» здесь значит «сильнее сдвинулось за сутки», а не причину движения.",
                "Курс метки (mark) и индекс биржи в этот срез не входят.",
            ],
            "note": (
                "Расхождение спота и деривативов — наблюдение о структуре рынка, "
                "а не сигнал покупать или продавать."
            ),
        }
        derivatives_cache[key] = {"at": now, "data": data}
        return data

    @app.get("/api/crypto/liquidity")
    def liquidity_route(
        symbol: str,
        notional: float = Query(1000.0, gt=0, le=100_000_000),
    ) -> dict:
        """Ликвидность стакана площадок: спред, полосы глубины, дисбаланс и
        оценка исполнения заданной суммы.

        Стакан — снимок: между запросом и заявкой он меняется. `partial` —
        площадка не набрала всю сумму. Недоступная площадка видна в sources с
        причиной, остальные считаются.
        """
        a = svc.adapters.get("crypto")
        if a is None:
            raise HTTPException(404, "Крипторынок не подключён")
        key = f"{getattr(a, 'exchange_id', '?')}:{symbol}:{notional}"
        now = time.time()
        hit = liquidity_cache.get(key)
        if hit is not None and now - hit["at"] < liquidity_ttl_s:
            return hit["data"]
        readings: dict[str, dict[str, Any]] = {}
        errors: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=len(CRYPTO_EXCHANGES)) as pool:
            futures = {pool.submit(a.order_book, x, symbol): x for x in CRYPTO_EXCHANGES}
            for fut in as_completed(futures):
                venue_id = futures[fut]
                try:
                    snap = liquidity_snapshot(fut.result(), notional)
                except MarketError as e:
                    errors[venue_id] = str(e)
                    continue
                if snap is None:
                    errors[venue_id] = f"{venue_id}: стакан не отдал лучшие цены"
                    continue
                readings[venue_id] = snap
        data = {
            "symbol": symbol,
            "notional": notional,
            "checked_at": svc.now_ms(),
            "venues_ok": len(readings),
            "best": {side: best_execution(readings, side) for side in ("buy", "sell")},
            "thresholds": {
                "depth_bands_pct": list(DEPTH_BANDS_PCT),
                "taker_fee_pct": TAKER_FEE_PCT,
            },
            "sources": [
                {"exchange": x, **(readings.get(x) or {}), "error": errors.get(x)}
                for x in CRYPTO_EXCHANGES
            ],
            "limitations": [
                "Стакан — снимок на момент запроса: между запросом и заявкой он меняется, истории стакана Compass не ведёт.",
                "Полосы ±0,1/0,5/1% и комиссия 0,1% — константы приложения: реальные тарифы бирж зависят от объёма и VIP-уровня.",
                "Глубина — в стоимости котировки (цена × количество): сырые количества и размеры контрактов площадок напрямую несравнимы.",
                "Стакан тоньше суммы помечен `partial`: числа — по набранной части, в «лучшие» такая площадка не попадает.",
                "Частичные исполнения внутри одной цены, очередь заявок и скрытая ликвидность не моделируются.",
                "Считается только спот: перпетивные стаканы в это сравнение не входят — свои размеры контрактов и шаги цен.",
            ],
            "note": "Оценка исполнения — наблюдение о текущем стакане, а не гарантия цены и не сигнал покупать или продавать.",
        }
        liquidity_cache[key] = {"at": now, "data": data}
        return data

    @app.get("/api/crypto/leadlag")
    def leadlag_route(
        symbol: str,
        tf: str = "5m",
        bars: int = Query(500, ge=MIN_BARS, le=2000),
        max_lag: int = Query(MAX_LAG, ge=1, le=30),
    ) -> dict:
        """Кто ведёт раньше по общим закрытым свечам: сдвинутые корреляции.

        Каждая пара площадок считается по своему пересечению закрытых свечей:
        биржа с пропусками не режет выборку остальным. «Ведёт» — статистический
        сдвиг доходностей на этом окне, а не назначенная биржа и не сигнал.
        Недоступная площадка видна в sources с причиной, остальные считаются.
        """
        a = svc.adapters.get("crypto")
        if a is None:
            raise HTTPException(404, "Крипторынок не подключён")
        if tf not in getattr(a, "timeframes", ()):
            raise HTTPException(422, f"Таймфрейм {tf} не поддерживается для крипты")
        key = f"{getattr(a, 'exchange_id', '?')}:{symbol}:{tf}:{bars}:{max_lag}"
        now = time.time()
        hit = leadlag_cache.get(key)
        if hit is not None and now - hit["at"] < leadlag_ttl_s:
            return hit["data"]
        series: dict[str, list[Candle]] = {}
        errors: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=len(CRYPTO_EXCHANGES)) as pool:
            futures = {
                pool.submit(a.fetch_venue, x, symbol, tf, bars): x for x in CRYPTO_EXCHANGES
            }
            for fut in as_completed(futures):
                venue_id = futures[fut]
                try:
                    rows = fut.result()
                except MarketError as e:
                    errors[venue_id] = str(e)
                    continue
                closed = closed_candles(rows, tf, svc.now_ms())
                if closed:
                    series[venue_id] = closed
                else:
                    errors[venue_id] = f"{venue_id}: закрытых свечей нет"
        calc = analyze(series, max_lag=max_lag)
        by_venue = {r["exchange"]: r for r in calc["sources"]}
        data = {
            "symbol": symbol,
            "tf": tf,
            "checked_at": svc.now_ms(),
            "state": calc["state"],
            "leader": calc["leader"],
            "bars_min": calc["bars_min"],
            "bars_max": calc["bars_max"],
            "pairs_total": calc["pairs_total"],
            "pairs_decided": calc["pairs_decided"],
            "thresholds": {
                "max_lag": max_lag,
                "min_bars": MIN_BARS,
                "t_min": T_MIN,
                "lead_share_min": LEAD_SHARE_MIN,
                "stable_thirds_min": STABLE_THIRDS_MIN,
                "min_lead_votes": MIN_LEAD_VOTES,
            },
            "sources": [
                {
                    **by_venue.get(
                        x,
                        {
                            "exchange": x,
                            "decided": 0,
                            "lead_votes": 0,
                            "frequency": None,
                            "ci_pct": None,
                            "median_lead_bars": None,
                            "thirds_led": 0,
                            "quiet": {"decided": 0, "frequency": None},
                            "volatile": {"decided": 0, "frequency": None},
                        },
                    ),
                    "error": errors.get(x),
                }
                for x in CRYPTO_EXCHANGES
            ],
            "pairs": calc["pairs"],
            "limitations": [
                (
                    "Сдвиг — ассоциация, а не причинность: лидерство на этом окне "
                    "не обещает будущих движений."
                ),
                (
                    "Каждая пара считается по своим общим свечам: у биржи с пропусками "
                    "пара короче, но чужие выборки не страдают."
                ),
                (
                    "Пара без значимого сдвига остаётся нерешённой: площадки, которые "
                    "просто движутся вместе, лидера не получают."
                ),
                "Трети и половины окна грубее скользящего анализа: режимы внутри части могут смешиваться.",
                (
                    "Публикация свечей у бирж асинхронна: мнимый сдвиг в один бар "
                    "возможен и без реального лидерства."
                ),
                (
                    "Меньше двух выигранных пар — площадка лидером не называется: "
                    "«устойчивого лидерства нет» — честный результат."
                ),
            ],
            "note": (
                "«Ведёт» — статистический сдвиг доходностей на выбранном окне, "
                "а не назначенная биржа и не сигнал покупать или продавать."
            ),
        }
        leadlag_cache[key] = {"at": now, "data": data}
        return data

    @app.get("/api/crypto/events")
    def events_route(
        symbol: str,
        tf: str = "15m",
        bars: int = Query(500, ge=EVENTS_MIN_BARS, le=2000),
        window: int = Query(10, ge=2, le=50),
    ) -> dict:
        """Разбор прошедших событий: что было вокруг всплесков и разлада.

        Событие — движение медианы площадок или рост расхождения между ними.
        Каждое событие приходит с окном свечей вокруг: это повтор прошлого для
        контекста, а не сигнал. Недоступная площадка видна в sources с причиной,
        остальные считаются.
        """
        a = svc.adapters.get("crypto")
        if a is None:
            raise HTTPException(404, "Крипторынок не подключён")
        if tf not in getattr(a, "timeframes", ()):
            raise HTTPException(422, f"Таймфрейм {tf} не поддерживается для крипты")
        key = f"{getattr(a, 'exchange_id', '?')}:{symbol}:{tf}:{bars}:{window}"
        now = time.time()
        hit = events_cache.get(key)
        if hit is not None and now - hit["at"] < events_ttl_s:
            return hit["data"]
        series: dict[str, list[Candle]] = {}
        errors: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=len(CRYPTO_EXCHANGES)) as pool:
            futures = {
                pool.submit(a.fetch_venue, x, symbol, tf, bars): x for x in CRYPTO_EXCHANGES
            }
            for fut in as_completed(futures):
                venue_id = futures[fut]
                try:
                    rows = fut.result()
                except MarketError as e:
                    errors[venue_id] = str(e)
                    continue
                closed = closed_candles(rows, tf, svc.now_ms())
                if closed:
                    series[venue_id] = closed
                else:
                    errors[venue_id] = f"{venue_id}: закрытых свечей нет"
        tf_ms = TIMEFRAME_MS[tf]
        combined = composite_rows(series, tf_ms)
        found = detect_events(combined)
        events = with_windows(combined, found["events"], window, tf_ms)
        data = {
            "symbol": symbol,
            "tf": tf,
            "bars": bars,
            "bars_scanned": len(combined),
            "checked_at": svc.now_ms(),
            "window": window,
            "events": events,
            "thresholds": {
                "move_mult": EVENT_MOVE_MULT,
                "move_min_pct": EVENT_MOVE_MIN_PCT,
                "dispersion_mult": EVENT_DISPERSION_MULT,
                "dispersion_min_pct": EVENT_DISPERSION_MIN_PCT,
                "move_pct": round(found["move_threshold_pct"], 4),
                "dispersion_pct": round(found["dispersion_threshold_pct"], 4),
                "max_events": MAX_EVENTS,
                "min_composite_venues": MIN_COMPOSITE_VENUES,
            },
            "sources": [
                {"exchange": x, "bars": len(series.get(x, ())), "error": errors.get(x)}
                for x in CRYPTO_EXCHANGES
            ],
            "limitations": [
                (
                    "Композит — медиана площадок: всплеск одной биржи движение рынка "
                    "не создаёт, но виден отдельным событием разлада."
                ),
                (
                    "Движение считается только между соседними метками без пропусков: "
                    "разрывный шаг не выдаётся за движение."
                ),
                (
                    "Порог события — оценка из этого же окна: на короткой истории он "
                    "менее устойчив, чем на длинной."
                ),
                (
                    "Разбор — спот и его волатильность: фандинг, открытый интерес, "
                    "базис, спред и стакан по истории не собираются — в разборе их нет."
                ),
                (
                    "Публикация свечей у бирж асинхронна: всплеск может выглядеть "
                    "резче, чем его видел рынок в реальности."
                ),
                (
                    "Событие — прошлое: окно показывает, что было вокруг, и не "
                    "предсказывает, что будет дальше."
                ),
            ],
            "note": (
                "Разбор события — контекст того, что уже произошло, а не сигнал: "
                "показываем окно вокруг всплеска, а не направление сделки."
            ),
        }
        events_cache[key] = {"at": now, "data": data}
        return data

    @app.get("/api/crypto/brief")
    def brief(symbol: str) -> dict:
        if "crypto" not in svc.adapters:
            raise HTTPException(404, "Крипторынок не подключён")
        daily = _daily(symbol)
        profile = coin_profile(daily)
        btc = _daily("BTC/USDT") if symbol.upper() != "BTC/USDT" else daily
        regime = btc_regime(btc)
        corr, overlap = correlation(
            {c.ts: c.close for c in daily}, {c.ts: c.close for c in btc}
        ) if symbol.upper() != "BTC/USDT" else (None, 0)
        link = btc_link_note(symbol, corr, overlap)
        currency = _quote(symbol)
        spread = None
        book = getattr(svc.adapters["crypto"], "order_book_spread", None)
        if book:
            try:
                spread = book(symbol)
            except MarketError:
                spread = None
        warnings = list(profile["warnings"])
        q = quote_warning(currency)
        if q:
            warnings.append(q)
        if regime["regime"] != "unknown" and not symbol.upper().startswith("BTC/"):
            warnings.append(regime["note"])
        return {
            "symbol": symbol,
            "exchange": getattr(svc.adapters["crypto"], "exchange_id", None),
            "currency": currency,
            "profile": profile,
            "btc": regime,
            "btc_correlation": corr,
            "btc_overlap": overlap,
            "btc_link": link,
            "spread": spread,
            "warnings": warnings,
            "education": list(EDUCATION),
            "rub": _rub(),
            "fee_note": (
                "Комиссия в расчётах — одна ставка 0,1% (типичный taker), без скидки за объём. "
                "Если биржа списала её в монете, в журнал пишите сумму в USDT: количество монеты × цена."
            ),
        }

    @app.post("/api/crypto/dca")
    def dca(req: DcaRequest) -> dict:
        return dca_plan(req.budget, req.parts, req.fee_pct, req.prices)

    @app.post("/api/crypto/fee-quote")
    def fee_quote(req: FeeCoinRequest) -> dict:
        quote = fee_in_quote(req.fee_coin, req.price)
        return {"fee_quote": quote, "note": "Эту сумму и записывайте в поле комиссии журнала."}

    @app.get("/api/journal/tax.csv")
    def tax_csv(year: int | None = Query(None), market: str | None = Query("crypto")) -> Response:
        report = fifo_report(svc.journal.list(mode="real"), year, market)
        buf = io.StringIO()
        buf.write("﻿")
        writer = csv.writer(buf)
        writer.writerow([report["disclaimer"]])
        writer.writerow(["market", "symbol", "year", "sell_ts_ms", "qty", "proceeds", "cost", "pnl"])
        for row in report["rows"]:
            writer.writerow([row["market"], row["symbol"], row["year"], row["sell_ts"], row["qty"], row["proceeds"], row["cost"], row["pnl"]])
        writer.writerow([])
        writer.writerow(["pnl_total", report["pnl"]])
        name = f"compass-fifo-{market or 'all'}-{year or 'all'}.csv"
        return Response(
            content=buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    def _daily(symbol: str) -> list:
        try:
            res = svc.cache.get("crypto", symbol, "1d", 500)
        except MarketError:
            return []
        return closed_candles(res.candles, "1d", svc.now_ms())

    def _ticker(a: Any, exchange_id: str | None, symbol: str) -> dict[str, float | None]:
        empty: dict[str, float | None] = {"last": None, "bid": None, "ask": None}
        if not exchange_id:
            return empty
        try:
            return a.quote(exchange_id, symbol)
        except MarketError:
            return empty

    def _gap_percentile(
        symbol: str, tf: str, limit: int, venue_candles: Sequence[Candle], gap: dict | None
    ) -> tuple[float | None, int]:
        """Перцентиль текущего расхождения среди общих закрытых свечей пары.

        Текущее значение — по котировкам ticker, история — по закрытым свечам:
        это разные срезы, но для «где мы относительно себя» годится. Мало общих
        свечей — перцентиль не выдумываем (None), число свечей отдаём для подписи.
        """
        if gap is None:
            return None, 0
        try:
            res = svc.cache.get("crypto", symbol, tf, limit)
        except MarketError:
            return None, 0
        now = svc.now_ms()
        hist = divergence_history(
            closed_candles(res.candles, tf, now),
            closed_candles(venue_candles, tf, now),
        )
        return percentile_rank(abs(gap["pct"]), hist), len(hist)

    def _quote(symbol: str) -> str | None:
        info = getattr(svc.adapters["crypto"], "instrument_info", None)
        if info is None:
            return symbol.split("/")[-1] if "/" in symbol else None
        try:
            return info(symbol).currency
        except MarketError:
            return symbol.split("/")[-1] if "/" in symbol else None

    def _rub() -> dict | None:
        now = time.time()
        cached = _rub_cache.get("data")
        if cached and now - _rub_cache.get("at", 0) < 3600:
            return cached
        try:
            r = httpx.get(_CBR, timeout=8.0)
            r.raise_for_status()
            parsed = parse_cbr_usd(r.json())
        except (httpx.HTTPError, ValueError):
            return cached
        data = {**parsed, **rub_per_usdt(parsed["usd_rub"])}
        _rub_cache["data"] = data
        _rub_cache["at"] = now
        return data
