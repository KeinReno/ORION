"""Калькулятор исходов сделки (IMPROVEMENT_SPEC §6): вход, стоп, цель, расходы.

Считает сценарные исходы для лонга: стоимость входа, расчётный убыток при стопе, чистую
прибыль при цели, соотношение выгоды к риску и долю капитала. Размер позиции — по риску
на сделку (как /api/risk) или по явному количеству.

Убыток при стопе и прибыль при цели — условные сценарии, а не гарантии: возможны гэп
и худшее исполнение. Формулы совпадают с risk.py и execution.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

from compass.risk import _loss_per_unit, position_size

SizingMode = Literal["risk", "qty"]


@dataclass(frozen=True, slots=True)
class TradeScenario:
    sizing_mode: SizingMode
    qty: float
    qty_requested: float | None  # исходное количество до округления к лоту/шагу
    lots: float
    cost: float
    risk_amount: float
    risk_amount_worse: float
    profit_at_target: float | None
    profit_at_target_worse: float | None
    reward_risk: float | None
    entry_expense: float
    exit_expense_at_stop: float
    exit_expense_at_target: float | None
    budget: float | None
    capital_pct: float | None
    capped: bool
    warning: str | None


def _paid_per_unit(entry: float, fee: float, slip: float, unit_value: float) -> float:
    return entry * (1 + slip) * (1 + fee) * unit_value


def _proceeds_per_unit(exit_price: float, fee: float, slip: float, unit_value: float) -> float:
    return exit_price * (1 - slip) * (1 - fee) * unit_value


def _profit_per_unit(entry: float, target: float, fee: float, slip: float, unit_value: float) -> float:
    return _proceeds_per_unit(target, fee, slip, unit_value) - _paid_per_unit(entry, fee, slip, unit_value)


def _round_qty(
    raw: float,
    *,
    lot: int,
    qty_step: float | None,
) -> tuple[float, float]:
    if qty_step:
        qty = math.floor(raw / qty_step + 1e-9) * qty_step
        return round(qty, 10), round(qty, 10)
    lots = math.floor(raw / lot + 1e-9)
    return round(lots * lot, 10), round(lots, 10)


def _validate_levels(entry: float, stop: float, target: float | None) -> None:
    if entry <= 0 or stop <= 0:
        raise ValueError("Цены входа и стопа должны быть положительными")
    if stop >= entry:
        raise ValueError("Стоп должен быть ниже цены входа (только лонг)")
    if target is not None and target <= entry:
        raise ValueError("Цель должна быть выше входа")


def compute_scenario(
    *,
    entry: float,
    stop: float,
    target: float | None,
    sizing_mode: SizingMode,
    capital: float | None,
    risk_pct: float | None,
    qty_input: float | None,
    lot: int,
    qty_step: float | None,
    fee_pct: float,
    slippage_pct: float,
    worse_slippage_pct: float,
    available: float | None,
    unit_value: float,
    accrued: float,
    min_qty: float | None,
    min_cost: float | None,
) -> TradeScenario:
    """Сценарий long: размер по риску или по явному количеству."""
    _validate_levels(entry, stop, target)
    fee, slip = fee_pct / 100, slippage_pct / 100
    worse_slip = worse_slippage_pct / 100
    per_unit_cost = _paid_per_unit(entry, fee, slip, unit_value) + accrued

    if sizing_mode == "risk":
        if capital is None or risk_pct is None:
            raise ValueError(
                "Для расчёта по риску нужны капитал и доля риска на сделку — задайте счёт или укажите вручную."
            )
        sized = position_size(
            capital,
            risk_pct,
            entry,
            stop,
            lot=lot,
            qty_step=qty_step,
            fee_pct=fee_pct,
            slippage_pct=slippage_pct,
            worse_slippage_pct=worse_slippage_pct,
            available=available,
            unit_value=unit_value,
            accrued=accrued,
            min_qty=min_qty,
            min_cost=min_cost,
        )
        qty, lots = sized.qty, sized.lots
        qty_requested = None
        budget = sized.budget
        capped = sized.capped
        warning = sized.warning
        risk_amount = sized.risk_amount
        risk_amount_worse = sized.risk_amount_worse
        cost = sized.cost
    else:
        if qty_input is None or qty_input <= 0:
            raise ValueError("Укажите количество больше нуля")
        qty_requested = float(qty_input)
        qty, lots = _round_qty(qty_input, lot=lot, qty_step=qty_step)
        budget = None
        capped = False
        warning = None
        cost = round(qty * per_unit_cost, 2)
        risk_amount = round(qty * _loss_per_unit(entry, stop, fee, slip, unit_value), 2)
        risk_amount_worse = round(qty * _loss_per_unit(entry, stop, fee, worse_slip, unit_value), 2)
        if qty <= 0:
            warning = "Количество после округления к лоту/шагу равно нулю."
        elif min_qty is not None and qty < min_qty - 1e-12:
            warning = "Количество меньше минимальной заявки биржи: такую заявку не примут."
            qty = lots = 0.0
            cost = risk_amount = risk_amount_worse = 0.0
        elif min_cost is not None and cost < min_cost:
            warning = f"Стоимость входа {cost:,.2f} меньше минимальной заявки биржи {min_cost:,.2f}.".replace(",", " ")
            qty = lots = 0.0
            cost = risk_amount = risk_amount_worse = 0.0
        if capital is not None and cost > (available if available is not None else capital):
            capped = True

    paid = _paid_per_unit(entry, fee, slip, unit_value)
    entry_expense = round(qty * (paid - entry * unit_value), 2)
    exit_at_stop = _proceeds_per_unit(stop, fee, slip, unit_value)
    exit_expense_at_stop = round(qty * (stop * unit_value - exit_at_stop), 2)

    profit_at_target = profit_at_target_worse = reward_risk = None
    exit_expense_at_target = None
    if target is not None and qty > 0:
        profit_at_target = round(qty * _profit_per_unit(entry, target, fee, slip, unit_value), 2)
        profit_at_target_worse = round(qty * _profit_per_unit(entry, target, fee, worse_slip, unit_value), 2)
        exit_at_target = _proceeds_per_unit(target, fee, slip, unit_value)
        exit_expense_at_target = round(qty * (target * unit_value - exit_at_target), 2)
        if risk_amount > 0:
            reward_risk = round(profit_at_target / risk_amount, 2)

    capital_pct = None
    if capital is not None and capital > 0 and cost > 0:
        capital_pct = round(cost / capital * 100, 2)

    return TradeScenario(
        sizing_mode=sizing_mode,
        qty=qty,
        qty_requested=qty_requested if sizing_mode == "qty" else None,
        lots=lots,
        cost=cost,
        risk_amount=risk_amount,
        risk_amount_worse=risk_amount_worse,
        profit_at_target=profit_at_target,
        profit_at_target_worse=profit_at_target_worse,
        reward_risk=reward_risk,
        entry_expense=entry_expense,
        exit_expense_at_stop=exit_expense_at_stop,
        exit_expense_at_target=exit_expense_at_target,
        budget=budget,
        capital_pct=capital_pct,
        capped=capped,
        warning=warning,
    )


def scenario_dto(s: TradeScenario, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    d = {
        "sizing_mode": s.sizing_mode,
        "qty": s.qty,
        "qty_requested": s.qty_requested,
        "lots": s.lots,
        "rounded": (
            s.qty_requested is not None
            and abs(s.qty - s.qty_requested) > 1e-9
        ),
        "cost": s.cost,
        "risk_amount": s.risk_amount,
        "risk_amount_worse": s.risk_amount_worse,
        "profit_at_target": s.profit_at_target,
        "profit_at_target_worse": s.profit_at_target_worse,
        "reward_risk": s.reward_risk,
        "expenses": {
            "entry": s.entry_expense,
            "exit_at_stop": s.exit_expense_at_stop,
            "exit_at_target": s.exit_expense_at_target,
        },
        "budget": s.budget,
        "capital_pct": s.capital_pct,
        "capped": s.capped,
        "warning": s.warning,
    }
    if extra:
        d.update(extra)
    return d
