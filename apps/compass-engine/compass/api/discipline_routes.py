"""Слой дисциплины и глоссарий: что изменилось, отступления от правил, сравнение плана с прежними."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, HTTPException, Query

from compass import discipline, glossary
from compass import review_week as review_week_mod
from compass.accounts import AccountStore
from compass.markets.base import MarketError
from compass.plans import PlanStore, plan_dto, review

if TYPE_CHECKING:
    from compass.api.app import Services


def register_discipline_routes(
    app: FastAPI,
    svc: Services,
    *,
    accounts_store: Callable[[], AccountStore],
    account_snapshot: Callable[..., dict],
    plan_store: Callable[[], PlanStore],
    signal_ctx: Callable[[], Any],
    signal_dto: Callable[..., dict],
    decision_cockpit: Callable[[], dict],
) -> tuple[Callable[[int], dict], Callable[[int], dict], Callable[[int], dict]]:
    """Возвращает changed_facts, discipline_data и compare_data: AI пересказывает эти же факты."""
    @app.get("/api/glossary")
    def glossary_list() -> list[dict]:
        """Короткие определения понятий: интерфейс показывает их рядом с находками, где они нужны."""
        return glossary.all_terms()

    def changed_facts(hours: int) -> dict:
        now = svc.now_ms()
        accounts = [account_snapshot(a) for a in accounts_store().list()]
        entries = [{"ts": e.ts, "symbol": e.symbol, "side": e.side, "qty": e.qty, "price": e.price}
                   for e in svc.journal.list(mode="real")]
        ctx = signal_ctx()
        signals = [signal_dto(sg, ctx) for sg in svc.signals.list(200)]
        plans = [plan_dto(p) for p in svc.plans.list(None, None, 100)] if svc.plans is not None else []
        moves = []
        for a in accounts:
            tf = svc.settings.get(f"tf_{a['market']}")
            for p in a["positions"]:
                try:
                    candles_ = svc.cache.get(a["market"], p["symbol"], tf, 5).candles
                except (MarketError, KeyError):
                    continue
                if len(candles_) >= 2 and candles_[-2].close > 0:
                    moves.append({"market": a["market"], "symbol": p["symbol"], "mark_price": candles_[-1].close,
                                  "change_pct": (candles_[-1].close / candles_[-2].close - 1) * 100})
        return discipline.what_changed(now, hours, accounts, entries, signals, plans, moves)

    @app.get("/api/discipline/changed")
    def discipline_changed(hours: int = Query(24, ge=1, le=168)) -> dict:
        """Что изменилось за окно: записи журнала, сигналы, планы, движение позиций. Всё считает код."""
        facts = changed_facts(hours)
        return {**facts, "text": discipline.facts_text_changed(facts)}

    def discipline_data(days: int) -> dict:
        now = svc.now_ms()
        weeklies = [
            review_week_mod.weekly(a, svc.journal.list(market=a.market, mode="real"), lambda uid: plan_store().get_by_uid(uid), now, days)
            for a in accounts_store().list()
        ]
        return discipline.discipline_facts(decision_cockpit(), weeklies)

    @app.get("/api/discipline/violations")
    def discipline_violations(days: int = Query(7, ge=1, le=31)) -> dict:
        """Где вы отступили от собственных правил и планов: текущие нарушения и картина недели."""
        data = discipline_data(days)
        return {**data, "text": discipline.facts_text_discipline(data)}

    def compare_data(plan_id: int) -> dict:
        store = plan_store()
        plan = store.get(plan_id)
        if plan is None:
            raise HTTPException(404, "План не найден")
        previous = [
            (p, review(p, svc.journal.list(p.market, p.symbol, mode=None)))
            for p in store.list(None, None, 200) if p.id is not None and plan.id is not None and p.id < plan.id
        ]
        return discipline.trade_comparison(plan, previous)

    @app.get("/api/discipline/compare-trade")
    def discipline_compare(plan_id: int) -> dict:
        """Чем план отличается от ваших прежних планов: размер, риск, стоп, цель. Только отличия, без оценок."""
        return compare_data(plan_id)

    return changed_facts, discipline_data, compare_data
