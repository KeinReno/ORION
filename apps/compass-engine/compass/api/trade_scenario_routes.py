"""Калькулятор исходов сделки (IMPROVEMENT_SPEC §6): ручной long-сценарий без сигнала."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from compass import execution
from compass.markets.base import MarketError
from compass.risk import WORSE_SLIPPAGE_MULT
from compass.trade_scenario import compute_scenario, scenario_dto

if TYPE_CHECKING:
    from compass.api.app import Services
    from compass.models import InstrumentInfo


class TradeScenarioRequest(BaseModel):
    market: str
    symbol: str
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    target: float | None = Field(None, gt=0)
    sizing_mode: Literal["risk", "qty"] = "risk"
    qty: float | None = Field(None, gt=0)
    capital: float | None = None
    risk_pct: float | None = None
    available: float | None = None
    fee_pct: float | None = None
    slippage_pct: float | None = None
    spread_pct: float | None = None


@dataclass(frozen=True, slots=True)
class TradeScenarioDeps:
    instrument_info: Callable[[str, str], InstrumentInfo]
    account_for: Callable[[str], object]
    account_snapshot: Callable[[object], dict]
    adapter: Callable[[str], object]
    crypto_qty_step: float


def build_trade_scenario(req: TradeScenarioRequest, deps: TradeScenarioDeps) -> dict:
    info = deps.instrument_info(req.market, req.symbol)
    acc = deps.account_for(req.market)
    capital = req.capital if req.capital is not None else acc.capital
    risk_pct = req.risk_pct if req.risk_pct is not None else acc.risk_pct
    snap = deps.account_snapshot(acc)
    available = req.available
    if available is None and snap["free"] is not None:
        available = max(0.0, snap["free"])

    is_crypto = req.market == "crypto"
    spread_pct = req.spread_pct
    if is_crypto and spread_pct is None:
        book = getattr(deps.adapter(req.market), "order_book_spread", None)
        if book is not None:
            try:
                spread = book(req.symbol)
            except MarketError:
                spread = None
            if spread:
                spread_pct = spread["spread_pct"]
    model = execution.model_for(req.market, req.fee_pct, req.slippage_pct, spread_pct)
    worse_slip = model.slippage_pct * WORSE_SLIPPAGE_MULT + model.spread_pct / 2
    bond = info.price_unit == "percent_of_face"
    if bond and not info.face_value:
        raise ValueError("Для облигации не получен номинал: посчитать сценарий нельзя")

    if req.sizing_mode == "risk" and capital is None:
        raise ValueError(
            f"Капитал счёта «{acc.name}» не задан: укажите его в настройках счёта ({acc.currency}) "
            "или передайте capital в запросе. Для расчёта по количеству выберите sizing_mode=qty."
        )

    scenario = compute_scenario(
        entry=req.entry,
        stop=req.stop,
        target=req.target,
        sizing_mode=req.sizing_mode,
        capital=capital,
        risk_pct=risk_pct,
        qty_input=req.qty,
        lot=info.lot,
        qty_step=(info.qty_step or deps.crypto_qty_step) if is_crypto else None,
        fee_pct=model.fee_pct,
        slippage_pct=model.effective_slippage_pct,
        worse_slippage_pct=worse_slip,
        available=available,
        unit_value=info.face_value / 100 if bond and info.face_value else 1.0,
        accrued=info.accrued or 0.0,
        min_qty=info.min_qty,
        min_cost=info.min_cost,
    )

    warnings: list[str] = [w for w in (scenario.warning,) if w]
    if not info.complete:
        warnings.append(
            "Параметры инструмента получены не полностью — проверьте лот, шаг цены и минимальную заявку."
        )
    for label, price in (("входа", req.entry), ("стопа", req.stop), *([("цели", req.target)] if req.target else [])):
        if info.price_step and abs(price / info.price_step - round(price / info.price_step)) > 1e-6:
            warnings.append(f"Цена {label} не кратна шагу цены {info.price_step:g}: биржа её не примет.")

    portfolio = None
    if scenario.qty > 0 and capital is not None:
        from compass import portfolio as pf

        portfolio = pf.assess_new_position(snap, acc, scenario.risk_amount, scenario.cost)
        warnings.extend(portfolio["warnings"])

    unit_value = info.face_value / 100 if bond and info.face_value else 1.0
    return scenario_dto(
        scenario,
        {
            "market": req.market,
            "symbol": req.symbol,
            "entry": req.entry,
            "stop": req.stop,
            "target": req.target,
            "capital": capital,
            "risk_pct": risk_pct if req.sizing_mode == "risk" else None,
            "currency": info.currency,
            "lot_size": info.lot,
            "unit_value": unit_value,
            "account": {"market": acc.market, "name": acc.name, "currency": acc.currency},
            "fee_pct": model.fee_pct,
            "slippage_pct": model.effective_slippage_pct,
            "portfolio": portfolio,
            "warnings": warnings,
            "assumptions": [
                "Убыток при стопе и прибыль при цели — расчётные сценарии, а не гарантии: возможны гэп и худшее исполнение.",
                (
                    f"Расходы: комиссия {model.fee_pct:g}%, проскальзывание {model.effective_slippage_pct:g}% "
                    f"с каждой стороны (проскальзывание {model.slippage_pct:g}% + половина спреда "
                    f"{model.spread_pct:g}%)."
                ),
                "«Сохранить план» фиксирует решение, а не покупку. Фактическая сделка записывается отдельно.",
            ],
        },
    )


def register_trade_scenario_routes(
    app: FastAPI,
    svc: Services,
    *,
    instrument_info: Callable[[str, str], InstrumentInfo],
    account_for: Callable[[str], object],
    account_snapshot: Callable[[object], dict],
    adapter: Callable[[str], object],
    crypto_qty_step: float,
) -> None:
    deps = TradeScenarioDeps(instrument_info, account_for, account_snapshot, adapter, crypto_qty_step)

    @app.post("/api/trade-scenario")
    def trade_scenario(req: TradeScenarioRequest) -> dict:
        if req.market not in svc.adapters:
            raise HTTPException(404, f"Неизвестный рынок: {req.market}")
        return build_trade_scenario(req, deps)
