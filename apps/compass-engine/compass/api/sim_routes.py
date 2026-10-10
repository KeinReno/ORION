"""Маршруты симуляции фьючерсов. Клиент получает только уже открытые свечи: будущее не покидает сервер."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import asdict
from typing import TYPE_CHECKING, Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from compass.futures_sim import SimConfig
from compass.markets.base import MarketError
from compass.models import InstrumentInfo, closed_candles
from compass.replay import MIN_REPLAY, MIN_WARMUP, Bar
from compass.sim_session import MAX_STEP, SimSession, SimSessionError, SimStore
from compass.strategies import candles_to_df
from compass.validation import data_fingerprint

if TYPE_CHECKING:
    from compass.api.app import Services

log = logging.getLogger(__name__)

DEFAULT_SIM_CAPITAL = 10_000.0
HISTORY_LIMIT = 5000


class SimStart(BaseModel):
    market: Literal["crypto"] = "crypto"
    symbol: str
    tf: str = "1h"
    replay_bars: int = Field(240, ge=MIN_REPLAY, le=2000)  # сколько свечей предстоит открыть
    capital: float | None = Field(None, gt=0)  # по умолчанию — счёт крипты или условная сумма
    leverage: float = Field(1.0, ge=1, le=100)
    maker_fee_pct: float | None = Field(None, ge=0, lt=100)
    taker_fee_pct: float | None = Field(None, ge=0, lt=100)
    slippage_pct: float | None = Field(None, ge=0, lt=100)
    spread_pct: float | None = Field(None, ge=0, lt=100)
    maint_margin_pct: float | None = Field(None, gt=0, lt=50)


class SimOrder(BaseModel):
    side: Literal["buy", "sell"]
    qty: float = Field(gt=0)
    kind: Literal["market", "limit", "stop"] = "market"
    price: float | None = Field(None, gt=0)
    trigger: float | None = Field(None, gt=0)
    reduce_only: bool = False
    sl: float | None = Field(None, gt=0)
    tp: float | None = Field(None, gt=0)


class SimStops(BaseModel):
    sl: float | None = Field(None, gt=0)
    tp: float | None = Field(None, gt=0)


class SimLeverage(BaseModel):
    leverage: float = Field(ge=1, le=100)


class SimStep(BaseModel):
    bars: int = Field(1, ge=1, le=MAX_STEP)


def register_sim_routes(
    app: FastAPI,
    svc: Services,
    instrument_info: Callable[[str, str], InstrumentInfo],
    adapter: Callable[[str], Any],
    crypto_step: float,
) -> None:
    if svc.sim is None:
        return
    store: SimStore = svc.sim

    def session(session_id: int) -> SimSession:
        s = store.get(session_id)
        if s is None:
            raise HTTPException(404, "Сессия симуляции не найдена")
        return s

    def dto(s: SimSession) -> dict[str, Any]:
        view = s.sim.view()
        cfg = s.sim.cfg
        return {
            "id": s.id, "owner": s.owner, "market": s.market, "symbol": s.symbol, "tf": s.tf, "source": s.source,
            "status": s.status, "cursor_ts": s.visible[-1].ts, "replayed": s.cursor - s.start_index,
            "remaining": s.remaining, "funding_source": s.funding_source,
            "config": {**asdict(cfg), "leverage": view["leverage"]},
            "account": {k: view[k] for k in ("cash", "available", "reserved", "equity", "unrealized", "funding_total")},
            "last_price": view["last_price"], "position": view["position"], "orders": view["orders"],
            "fills": [asdict(f) for f in s.sim.fills],
            "curve": [[t, round(v, 2)] for t, v in s.curve],
            "result": s.result(),
            "notes": [
                "Учебные деньги: реальных заявок нет, в журнал сделок и статистику счетов они не попадают.",
                (
                    "Заявка исполняется начиная со следующей свечи; внутри свечи правила консервативные: стоп раньше "
                    "цели, лимитная заявка требует, чтобы цена прошла сквозь уровень."
                ),
                "Цены — свечи спота; у бессрочного контракта они отличаются на величину базиса.",
                "Фандинг — "
                + ("фактические ставки биржи." if s.funding_source == "history" else "оценка 0,01% за 8 часов: биржа историю не отдала."),
                "Вы видите даты: если помните, что было на самом деле, это подсказка, которой в реальной торговле нет.",
            ],
        }

    def done(s: SimSession, events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        store.save(s)
        out = dto(s)
        if events is not None:
            out["events"] = events
        return out

    def check_qty(s: SimSession, qty: float) -> None:
        info = instrument_info(s.market, s.symbol)
        step = info.qty_step or crypto_step
        if abs(qty / step - round(qty / step)) > 1e-6:
            raise SimSessionError(f"Количество должно быть кратно шагу {step:g}")
        if info.min_qty is not None and qty < info.min_qty:
            raise SimSessionError(f"Количество меньше минимальной заявки биржи ({info.min_qty:g})")

    @app.post("/api/sim", status_code=201)
    def sim_start(req: SimStart) -> dict:
        a = adapter(req.market)
        res = svc.cache.get(req.market, req.symbol, req.tf, HISTORY_LIMIT)
        candles = closed_candles(res.candles, req.tf, svc.now_ms())
        need = req.replay_bars + MIN_WARMUP
        if len(candles) < need:
            raise SimSessionError(
                f"Мало истории: нужно хотя бы {need} закрытых свечей (есть {len(candles)}). Уменьшите число свечей."
            )
        acc = svc.accounts.get(req.market) if svc.accounts else None
        capital = req.capital or (acc.capital if acc and acc.capital else DEFAULT_SIM_CAPITAL)
        base = SimConfig(capital=capital)
        cfg = SimConfig(
            capital=capital, leverage=req.leverage,
            maker_fee_pct=base.maker_fee_pct if req.maker_fee_pct is None else req.maker_fee_pct,
            taker_fee_pct=base.taker_fee_pct if req.taker_fee_pct is None else req.taker_fee_pct,
            slippage_pct=base.slippage_pct if req.slippage_pct is None else req.slippage_pct,
            spread_pct=base.spread_pct if req.spread_pct is None else req.spread_pct,
            maint_margin_pct=base.maint_margin_pct if req.maint_margin_pct is None else req.maint_margin_pct,
        )
        bars = [Bar(c.ts, c.open, c.high, c.low, c.close, c.volume) for c in candles]
        start = len(bars) - 1 - req.replay_bars
        funding: list[tuple[int, float]] = []
        fsrc = "estimate"
        fetch = getattr(a, "funding_history", None)
        if fetch is not None:
            try:
                got = fetch(a.exchange_id, req.symbol, bars[start].ts)
                funding = [(t, r) for t, r in got if t >= bars[start].ts]
                fsrc = "history" if funding else "estimate"
            except MarketError as e:
                log.info("История funding недоступна, берём оценку: %s", e)
        s = store.create(
            market=req.market, symbol=req.symbol, tf=req.tf, source=res.source or req.market, cfg=cfg, bars=bars,
            start_index=start, data_hash=data_fingerprint(candles_to_df(candles)), funding=funding,
            funding_source=fsrc,
        )
        return dto(s)

    @app.get("/api/sim")
    def sim_list() -> list[dict]:
        return store.list()

    @app.get("/api/sim/{session_id}")
    def sim_get(session_id: int) -> dict:
        return dto(session(session_id))

    @app.get("/api/sim/{session_id}/candles")
    def sim_candles(session_id: int) -> dict:
        s = session(session_id)
        return {
            "source": s.source,
            "candles": [{"t": b.ts, "o": b.o, "h": b.h, "l": b.low, "c": b.c, "v": b.v} for b in s.visible],
        }

    @app.get("/api/sim/{session_id}/log")
    def sim_log(session_id: int, after: int = 0) -> list[dict]:
        session(session_id)
        return store.log(session_id, after)

    @app.post("/api/sim/{session_id}/order")
    def sim_order(session_id: int, req: SimOrder) -> dict:
        s = session(session_id)
        check_qty(s, req.qty)
        res = s.order(**req.model_dump())
        out = done(s)
        out["order_id"] = res["order_id"]
        return out

    @app.delete("/api/sim/{session_id}/order/{order_id}")
    def sim_cancel(session_id: int, order_id: int) -> dict:
        s = session(session_id)
        s.cancel(order_id)
        return done(s)

    @app.post("/api/sim/{session_id}/close")
    def sim_close(session_id: int) -> dict:
        s = session(session_id)
        s.close()
        return done(s)

    @app.post("/api/sim/{session_id}/stops")
    def sim_stops(session_id: int, req: SimStops) -> dict:
        s = session(session_id)
        s.stops(req.sl, req.tp)
        return done(s)

    @app.post("/api/sim/{session_id}/leverage")
    def sim_leverage(session_id: int, req: SimLeverage) -> dict:
        s = session(session_id)
        s.leverage(req.leverage)
        return done(s)

    @app.post("/api/sim/{session_id}/step")
    def sim_step(session_id: int, req: SimStep) -> dict:
        s = session(session_id)
        events = s.step(req.bars)
        return done(s, events)

    @app.post("/api/sim/{session_id}/finish")
    def sim_finish(session_id: int) -> dict:
        s = session(session_id)
        store.finish(s)
        return dto(s)
