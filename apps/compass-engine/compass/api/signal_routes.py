"""Сигналы и наблюдение: лента, статусы, ручной скан, состояние сканера."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, HTTPException, Query

from compass.models import TIMEFRAME_MS, closed_candles, feed_delay_s
from compass.settings import profile_key
from compass.signal_replay import build_replay
from compass.signals import (
    HISTORY,
    Signal,
    _chosen_strategies,
    assess_signal,
    in_quiet_hours,
    load_signal_facts,
    signal_expires_at,
)
from compass.strategies import STRATEGIES, candles_to_df
from compass.swing import outcome as swing_outcome

if TYPE_CHECKING:
    from compass.api.app import Services


def register_signal_routes(
    app: FastAPI,
    svc: Services,
) -> tuple[Callable[[], Any], Callable[..., dict], Callable[[], dict]]:
    """Возвращает signal_ctx, signal_dto и watch_status: ими пользуются кокпит, скринер и слой дисциплины."""
    @app.get("/api/signals")
    def signals_list(
        limit: int = Query(100, ge=1, le=500),
        unseen: bool = False,
        market: str | None = None,
        symbol: str | None = None,
        status: str | None = None,
    ) -> list[dict]:
        if status is not None and status not in ("active", "expired", "invalidated", "dismissed"):
            raise ValueError("Статус сигнала — active, expired, invalidated или dismissed")
        ctx = signal_ctx()
        # при фильтре по статусу берём с запасом: срок и «действовали» вычисляются при чтении, а не хранятся
        rows = svc.signals.list(500 if status else limit, unseen, market, symbol)
        out = [signal_dto(s, ctx) for s in rows]
        return [d for d in out if d["status"] == status][:limit] if status else out

    @app.get("/api/signals/replay")
    def signals_replay(
        market: str,
        symbol: str,
        tf: str,
        strategy: str | None = None,
        limit: int = Query(500, ge=60, le=5000),
    ) -> dict:
        """Правило стратегии на свечах графика: сделки, линии, расстояние до сигнала. Не запись в журнал сигналов."""
        if market not in svc.adapters:
            raise HTTPException(404, "Неизвестный рынок")
        if tf not in TIMEFRAME_MS:
            raise ValueError("Неизвестный таймфрейм")
        cfg = svc.settings.all()
        own = cfg["instrument_strategies"].get(profile_key(market, symbol))
        if strategy is not None:
            strat = STRATEGIES.get(strategy)
            if strat is None:
                raise HTTPException(404, f"Неизвестная стратегия: {strategy}")
            params = strat.resolve({k: int(v) for k, v in own["params"].items()} if own and own["strategy"] == strat.id else None)
        else:
            strat, params = _chosen_strategies(cfg, market, symbol)[0]
        res = svc.cache.get(market, symbol, tf, max(limit, HISTORY))
        closed = closed_candles(res.candles, tf, svc.now_ms())
        scanned = cfg.get(f"tf_{market}")
        base = {
            "market": market, "symbol": symbol, "tf": tf, "scanned_tf": scanned, "stale": res.stale,
            "note": strat.market_notes.get(market),
            "strategies": [{"id": s.id, "name": s.name} for s in STRATEGIES.values()],
        }
        if len(closed) < 30:
            return {**base, "available": False, "reason": "Слишком мало закрытых свечей"}
        return {**base, "available": True, **build_replay(candles_to_df(closed[-limit:]), strat, params)}

    @app.post("/api/signals/{signal_id}/dismiss")
    def signal_dismiss(signal_id: int) -> dict:
        """Отклонить сигнал: он не считается актуальным и не будет рассылаться. Обратимо."""
        if svc.signals.get(signal_id) is None:
            raise HTTPException(404, "Сигнал не найден")
        svc.signals.dismiss(signal_id, svc.now_ms() // 1000)
        return signal_dto(svc.signals.get(signal_id), signal_ctx())

    @app.post("/api/signals/{signal_id}/restore")
    def signal_restore(signal_id: int) -> dict:
        if svc.signals.get(signal_id) is None:
            raise HTTPException(404, "Сигнал не найден")
        svc.signals.undismiss(signal_id)
        return signal_dto(svc.signals.get(signal_id), signal_ctx())

    @app.post("/api/signals/seen")
    def signals_seen(market: str | None = None) -> dict:
        if market not in (None, "moex", "crypto"):
            raise HTTPException(400, "Неизвестный рынок")
        return {"marked": svc.signals.mark_all_seen(market)}

    @app.post("/api/scan")
    def scan_now() -> dict:
        r = svc.engine.scan()
        ctx = signal_ctx()
        stored = {(x.market, x.symbol, x.tf, x.strategy, x.candle_ts, x.side): x for x in svc.signals.list(500)}
        new = [stored.get((s.market, s.symbol, s.tf, s.strategy, s.candle_ts, s.side), s) for s in r.new]
        return {"new": [signal_dto(s, ctx) for s in new], "errors": r.errors}

    def signal_ctx():
        return load_signal_facts(
            svc.signals, svc.journal, svc.plans, svc.now_ms(), int(svc.settings.get("signal_valid_bars")),
        )

    def signal_dto(s: Signal, ctx) -> dict:
        d = asdict(s)
        d.update(assess_signal(s, ctx))
        d["expires_at"] = signal_expires_at(s, ctx.valid_bars)
        delay = feed_delay_s(s.market, s.tf)
        d["delay_seconds"] = delay
        # данные приходят позже, чем живёт сигнал: к моменту получения он уже мог устареть
        d["late"] = bool(delay) and delay * 1000 >= TIMEFRAME_MS[s.tf] * ctx.valid_bars
        d["swing"] = swing_outcome(s.price, s.stop, s.target, s.leverage, s.stake)
        d["loss_risk"] = None
        if d["swing"] is None and s.stop is not None and svc.accounts is not None:
            acc = svc.accounts.get(s.market)
            if acc is not None and acc.capital is not None and acc.capital > 0:
                d["loss_risk"] = {
                    "loss_money": round(acc.capital * acc.risk_pct / 100, 2),
                    "loss_pct": acc.risk_pct,
                    "currency": acc.currency,
                }
        return d

    @app.get("/api/watch")
    def watch_status() -> dict:
        """Что и как наблюдается. Проверка идёт, пока работает процесс Compass (окно или значок в трее)."""
        cfg = svc.settings.all()
        background = bool(svc.shell and svc.shell.tray and cfg["background_mode"])
        now = svc.now_ms()
        sc = svc.scanner
        states = {(x["market"], x["symbol"]): x for x in svc.signals.states()}
        items = []
        for inst in svc.watchlist.list():
            st = states.get((inst.market, inst.symbol))
            paused = f"{inst.market}|{inst.symbol}" in cfg["paused_instruments"]
            items.append({
                "market": inst.market, "symbol": inst.symbol, "paused": paused,
                "status": "paused" if paused else (st["status"] if st else "unknown"),
                "message": "" if not st else st["message"], "last_scan_at": st and st["last_scan_at"],
                "last_ok_at": st and st["last_ok_at"],
            })
        warns = []
        for mk in ("moex", "crypto"):
            tfm = cfg.get(f"tf_{mk}")
            if tfm is None:
                continue
            window_ms = TIMEFRAME_MS[tfm] * cfg["signal_valid_bars"]
            if cfg["scan_interval_min"] * 60_000 > window_ms:
                warns.append(
                    f"Рынок {mk}: свеча {tfm}, сигнал актуален {cfg['signal_valid_bars']} св. "
                    f"({window_ms // 60_000} мин), а проверка идёт раз в {cfg['scan_interval_min']} мин: часть сигналов устареет до проверки."
                )
            delay = feed_delay_s(mk, tfm)
            if delay:
                warns.append(f"Рынок {mk}: данные с задержкой ~{delay // 60} мин, на таймфрейме {tfm} сигналы запаздывают.")
        return {
            "warnings": warns,
            "background_scanner": bool(sc and sc.alive),
            "interval_min": cfg["scan_interval_min"],
            "last_scan_at": svc.engine.last_scan_at,
            "next_scan_at": sc.next_scan_at if sc and sc.alive else None,
            "quiet_hours": {**cfg["quiet_hours"], "active_now": in_quiet_hours(cfg["quiet_hours"], now)},
            "signal_valid_bars": cfg["signal_valid_bars"],
            "instruments": items,
            "background_mode": background,
            "notes": [
                (
                    "Окно можно закрыть: Compass останется в трее и продолжит наблюдение. После «Выход» в меню значка "
                    "или выключения компьютера сигналы не ищутся и уведомления не приходят."
                    if background
                    else "Наблюдение работает только при запущенном приложении: если закрыть Compass, сигналы не ищутся "
                    "и уведомления не приходят."
                ),
                (
                    "Сигнал появляется на закрытой свече. Если проверка пропустила бары, переход всё равно записывается. "
                    "По незакрытой свече и по устаревшим данным сигналы не создаются."
                ),
            ],
        }

    return signal_ctx, signal_dto, watch_status
