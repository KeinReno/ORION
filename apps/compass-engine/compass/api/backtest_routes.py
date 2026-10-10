"""Проверка правил: стратегии, бэктест, проверка вне выборки, лаборатория, история экспериментов."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from typing import TYPE_CHECKING

import numpy as np
from fastapi import FastAPI, HTTPException, Query

from compass import discipline, execution, oos
from compass import lab as lab_mod
from compass.accounts import MARKET_TZ
from compass.api.schemas import BacktestRequest, LabRequest, ValidateRequest
from compass.backtest import Rules, backtest
from compass.data_quality import check_candles
from compass.experiments import Experiment, multiple_testing_warning
from compass.integrity import integrity_report
from compass.markets.base import MarketAdapter
from compass.models import INTRADAY_TFS, InstrumentInfo, closed_candles, feed_delay_s
from compass.strategies import STRATEGIES, candles_to_df, strategy_version
from compass.validation import (
    apply_sample_rules,
    cost_stress_warning,
    risk_ratios,
    run_card,
    trade_resampling,
    trade_stats,
    walk_forward,
)

if TYPE_CHECKING:
    from compass.api.app import Services


CRYPTO_QTY_STEP = 1e-6
def register_backtest_routes(
    app: FastAPI,
    svc: Services,
    *,
    adapter: Callable[[str], MarketAdapter],
    candles: Callable[..., dict],
    instrument_info: Callable[[str, str], InstrumentInfo],
) -> Callable[..., dict]:
    """Возвращает compute_backtest: тот же расчёт нужен AI-объяснению (без записи в историю проверок)."""
    @app.get("/api/strategies")
    def strategies() -> list[dict]:
        return [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "params": [asdict(p) for p in s.params],
                "market_notes": s.market_notes,
            }
            for s in STRATEGIES.values()
        ]

    def load_series(req: BacktestRequest, min_candles: int = 30):
        """Закрытые свечи для расчёта: незакрытая ещё меняется, расчёт по ней показал бы то, чего не было."""
        res = svc.cache.get(req.market, req.symbol, req.tf, req.limit)
        candles = closed_candles(res.candles, req.tf, svc.now_ms())
        if len(candles) < min_candles:
            raise ValueError(f"Слишком мало истории (нужно хотя бы {min_candles} закрытых свечей)")
        return res, candles_to_df(candles), len(candles) < len(res.candles), check_candles(candles, req.market, req.tf)

    def make_rules(req: BacktestRequest) -> Rules | None:
        if req.stop_atr_mult is None and req.target_r is None and req.risk_pct is None and not req.close_eod:
            return None
        tz_ms = int(MARKET_TZ[req.market].utcoffset(None).total_seconds() * 1000) if req.market in MARKET_TZ else 0
        Rules(stop_atr_mult=req.stop_atr_mult, target_r=req.target_r, risk_pct=req.risk_pct, close_eod=req.close_eod,
              tz_offset_ms=tz_ms).check()
        if req.stop_atr_mult is None and req.risk_pct is None:
            return Rules(close_eod=req.close_eod, tz_offset_ms=tz_ms)
        info = instrument_info(req.market, req.symbol)
        bond = info.price_unit == "percent_of_face"
        if bond and not info.face_value:
            raise ValueError("Для облигации не получен номинал: посчитать размер по риску нельзя")
        return Rules(
            stop_atr_mult=req.stop_atr_mult, target_r=req.target_r, risk_pct=req.risk_pct, lot=info.lot,
            qty_step=(info.qty_step or CRYPTO_QTY_STEP) if req.market == "crypto" else None,
            unit_value=info.face_value / 100 if bond and info.face_value else 1.0,
            close_eod=req.close_eod, tz_offset_ms=tz_ms,
        )

    def rules_dict(rules: Rules | None) -> dict | None:
        if rules is None:
            return None
        return {
            "stop_atr_mult": rules.stop_atr_mult, "target_r": rules.target_r, "risk_pct": rules.risk_pct,
            "atr_period": rules.atr_period, "lot": rules.lot, "qty_step": rules.qty_step, "unit_value": rules.unit_value,
            "close_eod": rules.close_eod,
        }

    def exec_model(req: BacktestRequest) -> execution.ExecutionModel:
        """Допущения исполнения запроса: комиссия и проскальзывание как заданы, спред — из профиля рынка."""
        return execution.model_for(req.market, req.fee_pct, req.slippage_pct, req.spread_pct, req.max_volume_pct)

    def exec_kw(model: execution.ExecutionModel) -> dict:
        return {"spread_pct": model.spread_pct, "max_participation_pct": model.max_participation_pct}

    def cost_stress(df, target, req, rules, bt, model) -> list[dict]:
        """Тот же результат при расходах ×1, ×2, ×3 (комиссия, проскальзывание и спред растут вместе)."""
        stress = []
        for mult in (1, 2, 3):
            m = model.worse(mult) if mult > 1 else model
            r = bt if mult == 1 else backtest(df, target, req.capital, m.fee_pct, m.slippage_pct, rules, **exec_kw(m))
            stress.append({"multiplier": mult, "fee_pct": round(m.fee_pct, 4), "slippage_pct": round(m.slippage_pct, 4),
                           "spread_pct": round(m.spread_pct, 4),
                           "return_pct": r.metrics["total_return_pct"], "trades": r.metrics["trades"]})
        return stress

    def intraday_block(req, strat, params, df, rules, bt, warnings: list[str], model, stress) -> dict:
        """Скальпинг и внутридневная торговля: расходы решают, история коротка, а МосБиржа отдаёт данные с опозданием."""
        tz = MARKET_TZ.get(req.market)
        off = int(tz.utcoffset(None).total_seconds() * 1000) if tz else 0
        ts = df["ts"].to_numpy().astype("int64")
        days = len(set(((ts + off) // 86_400_000).tolist()))
        cost = model.round_trip_cost_pct
        n = bt.metrics["trades"]
        if days < 20:
            warnings.append(
                f"История покрывает {days} торговых дней: для внутридневной стратегии этого мало, результат может быть случайным."
            )
        fragile = cost_stress_warning(stress)
        if fragile:
            warnings.append(fragile)
        if not req.close_eod:
            warnings.append("Позиции удерживаются через ночь: для внутридневной торговли включите закрытие к концу дня.")
        delay = feed_delay_s(req.market, req.tf)
        if delay:
            warnings.append(
                f"Котировки {req.market.upper()} идут с задержкой ~{delay // 60} мин: на таймфрейме {req.tf} реальный "
                "сигнал придёт с опозданием, эту проверку нельзя считать применимой к скальпингу."
            )
        return {
            "tf": req.tf, "trading_days": days, "trades_per_day": round(n / days, 2) if days else None,
            "round_trip_cost_pct": round(cost, 4), "cost_stress": stress, "feed_delay_seconds": delay,
        }

    @app.post("/api/backtest")
    def run_backtest(req: BacktestRequest) -> dict:
        return compute_backtest(req)

    def compute_backtest(req: BacktestRequest, record: bool = True) -> dict:
        """record=False — расчёт «для объяснения»: в историю экспериментов не пишется и число проб не растёт."""
        adapter(req.market)
        strat = STRATEGIES.get(req.strategy)
        if strat is None:
            raise HTTPException(404, f"Неизвестная стратегия: {req.strategy}")
        params = strat.resolve(req.params)
        res, df, open_dropped, quality = load_series(req)
        rules = make_rules(req)
        model = exec_model(req)
        target = strat.target(df, params)
        bt = backtest(df, target, req.capital, model.fee_pct, model.slippage_pct, rules, **exec_kw(model))
        stress = cost_stress(df, target, req, rules, bt, model)
        ts = df["ts"].to_numpy()
        eq = np.array([v for _, v in bt.equity])
        metrics, warnings = apply_sample_rules(
            {
                **bt.metrics,
                **risk_ratios(eq, ts, req.capital, bt.metrics["max_drawdown_pct"]),
                **trade_stats(bt.trades),
            }
        )
        if open_dropped:
            warnings.append("Последняя свеча ещё не закрыта и в расчёт не входит.")
        m = bt.metrics
        intraday = None
        if req.tf in INTRADAY_TFS:
            intraday = intraday_block(req, strat, params, df, rules, bt, warnings, model, stress)
        if m.get("ambiguous_bars"):
            warnings.append(
                f"В {m['ambiguous_bars']} свечах достигнуты и стоп, и цель: порядок внутри свечи неизвестен, "
                "принят стоп (консервативно)."
            )
        if m.get("gap_exits"):
            warnings.append(f"Выходов по гэпу: {m['gap_exits']}. Исполнение было хуже уровня стопа.")
        integrity = integrity_report(strat, params, df, target, bt, req.capital, model.effective_slippage_pct, rules, model.fee_pct)
        if not integrity["passed"]:
            warnings.insert(0, integrity["summary"])
        part = m.get("max_participation_pct")
        if part and part > execution.LIQUIDITY_WARN_PCT:
            warnings.append(
                f"Заявки занимали бы до {part:g}% объёма свечи: на такой размер рынок мог не дать цены свечи, "
                "реальное исполнение было бы хуже. Уменьшите размер или включите ограничение по объёму."
            )
        if m.get("liquidity_capped_entries"):
            warnings.append(
                f"Размер входа урезан по объёму свечи {m['liquidity_capped_entries']} раз: "
                f"допущено не больше {model.max_participation_pct:g}% объёма."
            )
        if m.get("illiquid_exits"):
            warnings.append(f"Выход не уместился в допустимую долю объёма {m['illiquid_exits']} раз: заявку пришлось бы дробить.")
        if m.get("zero_volume_fills"):
            warnings.append(
                f"У {m['zero_volume_fills']} исполнений объём свечи неизвестен (ноль): ликвидность по ним не оценена."
            )
        if m.get("skipped_entries"):
            warnings.append(
                f"Вход по сигналу пропущен {m['skipped_entries']} раз: открытие уже ниже стопа, "
                "идёт прогрев ATR или размер по риску округлился до нуля."
            )
        out = {
            "strategy": strat.id,
            "params": params,
            "stale": res.stale,
            "metrics": metrics,
            "data_quality": quality,
            "warnings": warnings,
            "intraday": intraday,
            "execution": {
                "model": {"fee_pct": model.fee_pct, "slippage_pct": model.slippage_pct, "spread_pct": model.spread_pct,
                          "max_participation_pct": model.max_participation_pct,
                          "round_trip_cost_pct": round(model.round_trip_cost_pct, 4)},
                "cost_stress": stress,
                "story": execution.cost_story(stress[0]["return_pct"], stress[-1]["return_pct"], model),
                "max_participation_pct": m.get("max_participation_pct"),
            },
            "coverage": {
                "requested": req.limit,
                "candles": len(df),
                "first_ts": int(df["ts"].iloc[0]),
                "last_ts": int(df["ts"].iloc[-1]),
                # получили меньше запрошенного — у источника больше нет; ровно столько — раньше история могла быть
                "exhausted": len(res.candles) < req.limit,
            },
            "integrity": integrity,
            "validation": {
                "walk_forward": walk_forward(df, bt, req.capital),
                "resampling": trade_resampling(bt.trades),
            },
            "run_card": run_card(
                df,
                market=req.market,
                symbol=req.symbol,
                tf=req.tf,
                strategy=strat.id,
                params=params,
                capital=req.capital,
                fee_pct=model.fee_pct,
                slippage_pct=model.slippage_pct,
                stale=res.stale,
                strategy_version=strategy_version(strat, params),
                rules=rules_dict(rules),
                spread_pct=model.spread_pct,
                max_participation_pct=model.max_participation_pct,
            ),
            "trades": [asdict(t) for t in bt.trades],
            "equity": [{"t": t, "v": round(v, 2)} for t, v in bt.equity],
        }
        if record:
            prior = record_experiment("backtest", req, strat.id, params, 1, out["run_card"], {
                k: metrics.get(k) for k in ("total_return_pct", "max_drawdown_pct", "trades", "avg_r", "sharpe")
            })
        else:
            prior = svc.experiments.variants_tried(req.market, req.symbol, req.tf, strat.id) if svc.experiments else 0
        out["trials"] = trials_dto(prior, 1 if record else 0)
        out["weaknesses"] = discipline.backtest_weaknesses(out)
        return out

    def record_experiment(kind, req, strategy_id, params, variants, card, result, extra_config=None) -> int:
        """Записывает запуск в неизменяемую историю; возвращает, сколько вариантов пробовали ДО него."""
        if svc.experiments is None:
            return 0
        prior = svc.experiments.variants_tried(req.market, req.symbol, req.tf, strategy_id)
        applied = execution.model_for(req.market, req.fee_pct, req.slippage_pct, card.get("spread_pct"))
        svc.experiments.add(
            Experiment(
                kind=kind, market=req.market, symbol=req.symbol, tf=req.tf, strategy=strategy_id,
                strategy_version=card.get("strategy_version"), params=params,
                config={
                    "capital": req.capital,
                    "fee_pct": applied.fee_pct,
                    "slippage_pct": applied.slippage_pct,
                    "spread_pct": card.get("spread_pct"), "max_participation_pct": card.get("max_participation_pct"),
                    "limit": req.limit, "rules": card.get("rules"), **(extra_config or {}),
                },
                data_hash=card["data_hash"], engine_version=card["engine_version"], candles=card["candles"],
                n_variants=variants, result=result,
            )
        )
        return prior

    def trials_dto(prior: int, this_run: int) -> dict:
        return {
            "prior_variants": prior, "this_run_variants": this_run, "total_variants": prior + this_run,
            "warning": multiple_testing_warning(prior + this_run),
        }

    @app.post("/api/validate")
    def validate_out_of_sample(req: ValidateRequest) -> dict:
        adapter(req.market)
        strat = STRATEGIES.get(req.strategy)
        if strat is None:
            raise HTTPException(404, f"Неизвестная стратегия: {req.strategy}")
        base = strat.resolve(req.params)
        res, df, open_dropped, quality = load_series(req, min_candles=oos.MIN_TRAIN_CANDLES + oos.MIN_TEST_CANDLES)
        rules = make_rules(req)
        model = exec_model(req)
        result = oos.run_oos(
            strat, base, req.grid, df, req.train_pct, req.capital, model.fee_pct, model.slippage_pct, rules, exec_kw(model)
        )
        chosen = (result["chosen"] or {}).get("params", base)
        card = run_card(
            df, market=req.market, symbol=req.symbol, tf=req.tf, strategy=strat.id, params=chosen, capital=req.capital,
            fee_pct=model.fee_pct, slippage_pct=model.slippage_pct, stale=res.stale,
            strategy_version=strategy_version(strat, chosen), rules=rules_dict(rules),
            spread_pct=model.spread_pct, max_participation_pct=model.max_participation_pct,
        )
        variants = result["optimization"]["variants"]
        summary = {
            "train_pct": req.train_pct, "chosen": chosen, "verdict": result["verdict"]["status"],
            "train_return_pct": ((result["chosen"] or {}).get("train") or {}).get("total_return_pct"),
            "test_return_pct": ((result["chosen"] or {}).get("test") or {}).get("total_return_pct"),
            "test_trades": ((result["chosen"] or {}).get("test") or {}).get("trades"),
        }
        prior = record_experiment(
            "validate", req, strat.id, chosen, variants, card, summary,
            {"train_pct": req.train_pct, "grid": req.grid},
        )
        warnings = []
        if open_dropped:
            warnings.append("Последняя свеча ещё не закрыта и в расчёт не входит.")
        if res.stale:
            warnings.append("Источник данных недоступен — расчёт по сохранённым данным.")
        return {
            **result, "strategy": strat.id, "strategy_version": card["strategy_version"], "run_card": card,
            "data_quality": quality, "warnings": warnings, "trials": trials_dto(prior, variants),
        }

    @app.post("/api/lab")
    def validation_lab(req: LabRequest) -> dict:
        """Лаборатория проверки: walk-forward в нескольких окнах, карта устойчивости, bootstrap, концентрация прибыли,
        просадки, режимы, стресс расходов, PBO и Deflated Sharpe. Вердикт — простым языком, детали — в слое исследователя."""
        adapter(req.market)
        strat = STRATEGIES.get(req.strategy)
        if strat is None:
            raise HTTPException(404, f"Неизвестная стратегия: {req.strategy}")
        base = strat.resolve(req.params)
        res, df, open_dropped, quality = load_series(req, min_candles=lab_mod.MIN_WINDOW * req.folds)
        rules = make_rules(req)
        model = exec_model(req)
        prior = svc.experiments.variants_tried(req.market, req.symbol, req.tf, strat.id) if svc.experiments else 0
        result = lab_mod.run_lab(
            strat, base, req.grid, df, folds=req.folds, mode=req.mode, capital=req.capital, fee_pct=model.fee_pct,
            slippage_pct=model.slippage_pct, spread_pct=model.spread_pct, rules=rules,
            max_participation_pct=model.max_participation_pct, prior_variants=prior,
        )
        card = run_card(
            df, market=req.market, symbol=req.symbol, tf=req.tf, strategy=strat.id, params=base, capital=req.capital,
            fee_pct=model.fee_pct, slippage_pct=model.slippage_pct, stale=res.stale,
            strategy_version=strategy_version(strat, base), rules=rules_dict(rules),
            spread_pct=model.spread_pct, max_participation_pct=model.max_participation_pct,
        )
        variants = result["multiple_testing"]["variants_this_run"]
        wf = result["walk_forward"]["summary"]
        record_experiment(
            "validate", req, strat.id, base, variants, card,
            {"lab": True, "verdict": result["verdict"]["status"], "folds": wf["folds"],
             "profitable_folds": wf["profitable_folds"], "stitched_return_pct": wf["stitched_return_pct"]},
            {"lab": True, "folds": req.folds, "mode": req.mode, "grid": req.grid},
        )
        warnings = []
        if open_dropped:
            warnings.append("Последняя свеча ещё не закрыта и в расчёт не входит.")
        if res.stale:
            warnings.append("Источник данных недоступен — расчёт по сохранённым данным.")
        return {
            **result, "strategy": strat.id, "strategy_version": card["strategy_version"], "run_card": card,
            "data_quality": quality, "warnings": warnings, "trials": trials_dto(prior, variants),
        }

    @app.get("/api/experiments")
    def experiments_list(
        market: str | None = None, symbol: str | None = None, limit: int = Query(100, ge=1, le=500)
    ) -> list[dict]:
        return svc.experiments.list(market, symbol, limit) if svc.experiments else []

    return compute_backtest
