"""Поиск сигналов по вотчлисту.

Сигнал — это СМЕНА целевой позиции стратегии (0→1 вход, 1→0 выход) на закрытой
свече. Незакрытая свеча игнорируется. Скан помнит, до какой свечи он уже дошёл:
если приложение пропустило бары, каждый переход внутри загруженной истории
записывается, а не только скачок на последних двух свечах. Первая встреча
с тикером смотрит только на последнюю закрытую свечу — старая история не
становится пачкой сигналов.

Один и тот же сигнал на одной свече хранится один раз (UNIQUE в БД).
Состояние стратегии (сейчас вне рынка или в позиции) хранится отдельно от
решения пользователя: план и запись в журнале не гасят саму идею.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, tzinfo

from compass.cache import CandleCache
from compass.db import Connection
from compass.indicators import atr
from compass.markets.base import MarketError
from compass.models import TIMEFRAME_MS, Candle, closed_candles
from compass.settings import Settings, profile_key
from compass.strategies import STRATEGIES, candles_to_df, canonical_params, strategy_version
from compass.swing import STOP_ATR_MULT as ATR_STOP_MULT
from compass.swing import swing_plan
from compass.watchlist import Watchlist

log = logging.getLogger("compass.signals")

# стоп риска потери: у лонга ниже цены открытия, у шорта выше
HISTORY = 300  # свечей для расчёта — с запасом над прогревом любой стратегии


@dataclass(frozen=True, slots=True)
class Signal:
    market: str
    symbol: str
    tf: str
    strategy: str
    side: str  # "buy" | "exit"
    candle_ts: int
    price: float
    stop: float | None = None
    id: int | None = None
    created_at: int | None = None
    seen: bool = False
    params: dict[str, int] | None = None  # параметры стратегии; None — сигнал создан до их сохранения
    strategy_version: str | None = None  # см. strategies.strategy_version; None — сигнал старого образца
    notified_at: int | None = None  # None — внешнее уведомление ещё не ушло (например, тихие часы)
    dismissed_at: int | None = None  # пользователь отклонил сигнал
    source: str | None = None  # биржа ряда, например crypto:okx; None — сигнал записан до этого поля
    entry_signal_id: int | None = None  # у выхода — вход, который он закрывает
    role: str = "action"  # action | note; у выхода note значит «идея закрылась», не просьба продавать
    target: float | None = None
    leverage: float | None = None
    stake: float | None = None
    fill_at: str | None = None  # next_open — МосБиржа, цена это открытие следующей свечи
    open_px: float | None = None
    direction: str | None = None  # long | short


@dataclass(frozen=True, slots=True)
class StrategyState:
    market: str
    symbol: str
    tf: str
    strategy: str
    target: int  # 0 вне рынка, 1 в позиции
    since_ts: int
    last_ts: int
    price: float
    stop: float | None
    params: dict[str, int] | None
    strategy_version: str | None
    source: str | None


@dataclass(frozen=True, slots=True)
class SignalFacts:
    """Всё, что нужно, чтобы посчитать статус сигнала, не храня его в строке."""

    now_ms: int
    valid_bars: int
    states: dict[tuple[str, str, str, str], StrategyState]
    taken: set[int]  # есть запись журнала
    planned: set[int]  # есть план
    open_plan_entries: set[int]  # план по этому входу ещё не закрыт
    held: set[tuple[str, str]]  # (рынок, тикер) с открытой реальной позицией
    stop_hits: set[int]


@dataclass(frozen=True, slots=True)
class ScanResult:
    new: list[Signal]
    errors: list[str]


_SIGNAL_SQL = (
    "market, symbol, tf, strategy, side, candle_ts, price, stop, id, created_at, seen, params, "
    "strategy_version, notified_at, dismissed_at, source, entry_signal_id, "
    "target, leverage, stake, fill_at, open_px, direction"
)


def _row_to_signal(r: tuple) -> Signal:
    return Signal(*r[:10], seen=bool(r[10]), params=json.loads(r[11]) if r[11] else None,
                  strategy_version=r[12], notified_at=r[13], dismissed_at=r[14], source=r[15],
                  entry_signal_id=r[16], target=r[17], leverage=r[18], stake=r[19], fill_at=r[20],
                  open_px=r[21], direction=r[22])


class SignalStore:
    def __init__(self, conn: Connection) -> None:
        self._conn = conn
        self._lock = conn.lock

    def insert(self, s: Signal) -> int | None:
        """id новой строки; None — такой сигнал уже был."""
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO signals "
                "(market, symbol, tf, strategy, side, candle_ts, price, stop, created_at, params, strategy_version, source, "
                "entry_signal_id, target, leverage, stake, fill_at, open_px, direction) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (s.market, s.symbol, s.tf, s.strategy, s.side, s.candle_ts, s.price, s.stop, int(time.time()),
                 None if s.params is None else json.dumps(s.params, sort_keys=True), s.strategy_version, s.source,
                 s.entry_signal_id, s.target, s.leverage, s.stake, s.fill_at, s.open_px, s.direction),
            )
        return int(cur.lastrowid) if cur.rowcount == 1 else None

    def list(
        self,
        limit: int = 100,
        unseen_only: bool = False,
        market: str | None = None,
        symbol: str | None = None,
    ) -> list[Signal]:
        where, args = [], []
        if unseen_only:
            where.append("seen = 0")
        if market:
            where.append("market = ?")
            args.append(market)
        if symbol:
            where.append("symbol = ?")
            args.append(symbol)
        sql = (
            f"SELECT {_SIGNAL_SQL} FROM signals "
            + (f"WHERE {' AND '.join(where)} " if where else "") + "ORDER BY id DESC LIMIT ?"
        )
        with self._lock:
            rows = self._conn.execute(sql, (*args, limit)).fetchall()
        return [_row_to_signal(r) for r in rows]

    def get(self, signal_id: int) -> Signal | None:
        with self._lock:
            row = self._conn.execute(
                f"SELECT {_SIGNAL_SQL} FROM signals WHERE id = ?",
                (signal_id,),
            ).fetchone()
        return _row_to_signal(row) if row else None

    def pending_notification(self) -> list[Signal]:
        """Сигналы, о которых ещё не уведомляли и которые пользователь не отклонил."""
        with self._lock:
            rows = self._conn.execute(
                f"SELECT {_SIGNAL_SQL} FROM signals "
                "WHERE notified_at IS NULL AND dismissed_at IS NULL ORDER BY id"
            ).fetchall()
        return [_row_to_signal(r) for r in rows]

    def mark_notified(self, ids: list[int], now_s: int) -> None:
        with self._lock, self._conn:
            self._conn.executemany("UPDATE signals SET notified_at = ? WHERE id = ?", [(now_s, i) for i in ids])

    def dismiss(self, signal_id: int, now_s: int) -> bool:
        with self._lock, self._conn:
            return (
                self._conn.execute(
                    "UPDATE signals SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL", (now_s, signal_id)
                ).rowcount
                == 1
            )

    def undismiss(self, signal_id: int) -> bool:
        with self._lock, self._conn:
            return (
                self._conn.execute(
                    "UPDATE signals SET dismissed_at = NULL WHERE id = ? AND dismissed_at IS NOT NULL", (signal_id,)
                ).rowcount
                == 1
            )

    def set_state(self, market: str, symbol: str, status: str, message: str, now_s: int) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO scan_state (market, symbol, status, message, last_scan_at, last_ok_at) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(market, symbol) DO UPDATE SET status=excluded.status, "
                "message=excluded.message, last_scan_at=excluded.last_scan_at, "
                "last_ok_at=CASE WHEN excluded.status='ok' THEN excluded.last_scan_at ELSE scan_state.last_ok_at END",
                (market, symbol, status, message, now_s, now_s if status == "ok" else None),
            )

    def states(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT market, symbol, status, message, last_scan_at, last_ok_at FROM scan_state ORDER BY market, symbol"
            ).fetchall()
        keys = ("market", "symbol", "status", "message", "last_scan_at", "last_ok_at")
        return [dict(zip(keys, r, strict=True)) for r in rows]

    def prune_states(self, keep: set[tuple[str, str]]) -> int:
        """Убирает состояния тикеров, которых больше нет в наблюдении: иначе панель дня годами показывает старые ошибки."""
        with self._lock, self._conn:
            gone = [
                (m, s)
                for m, s in self._conn.execute("SELECT market, symbol FROM scan_state").fetchall()
                if (m, s) not in keep
            ]
            self._conn.executemany("DELETE FROM scan_state WHERE market=? AND symbol=?", gone)
        return len(gone)

    def mark_all_seen(self, market: str | None = None) -> int:
        """Отметить прочитанными все сигналы или только одного рынка: рынки в панели не смешиваются."""
        with self._lock, self._conn:
            if market is None:
                return self._conn.execute("UPDATE signals SET seen = 1 WHERE seen = 0").rowcount
            return self._conn.execute("UPDATE signals SET seen = 1 WHERE seen = 0 AND market = ?", (market,)).rowcount

    def buy_id(self, market: str, symbol: str, tf: str, strategy: str, candle_ts: int) -> int | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT id FROM signals WHERE market=? AND symbol=? AND tf=? AND strategy=? AND side='buy' AND candle_ts=?",
                (market, symbol, tf, strategy, candle_ts),
            ).fetchone()
        return int(row[0]) if row else None

    def strategy_state(self, market: str, symbol: str, tf: str, strategy: str) -> StrategyState | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT market, symbol, tf, strategy, target, since_ts, last_ts, price, stop, params, strategy_version, source "
                "FROM strategy_state WHERE market=? AND symbol=? AND tf=? AND strategy=?",
                (market, symbol, tf, strategy),
            ).fetchone()
        return _row_to_state(row) if row else None

    def strategy_states(self) -> list[StrategyState]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT market, symbol, tf, strategy, target, since_ts, last_ts, price, stop, params, strategy_version, source "
                "FROM strategy_state"
            ).fetchall()
        return [_row_to_state(r) for r in rows]

    def save_strategy_state(self, st: StrategyState, now_s: int) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO strategy_state "
                "(market, symbol, tf, strategy, target, since_ts, last_ts, price, stop, params, strategy_version, source, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(market, symbol, tf, strategy) DO UPDATE SET "
                "target=excluded.target, since_ts=excluded.since_ts, last_ts=excluded.last_ts, price=excluded.price, "
                "stop=excluded.stop, params=excluded.params, strategy_version=excluded.strategy_version, "
                "source=excluded.source, updated_at=excluded.updated_at",
                (st.market, st.symbol, st.tf, st.strategy, st.target, st.since_ts, st.last_ts, st.price, st.stop,
                 None if st.params is None else json.dumps(st.params, sort_keys=True), st.strategy_version, st.source, now_s),
            )

    def stop_hits(self) -> set[int]:
        """Входы, после свечи которых минимум уходил на ориентир стопа или ниже."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT s.id FROM signals s WHERE s.stop IS NOT NULL AND EXISTS ("
                "SELECT 1 FROM candles c WHERE c.market = s.market AND c.symbol = s.symbol AND c.tf = s.tf "
                "AND c.ts > s.candle_ts AND (s.source IS NULL OR c.source = s.source) AND ("
                "(IFNULL(s.direction, 'long') = 'short' AND c.high >= s.stop) OR "
                "(IFNULL(s.direction, 'long') != 'short' AND c.low <= s.stop)))"
            ).fetchall()
        return {int(r[0]) for r in rows}


def _key(s: Signal) -> tuple:
    return (s.market, s.symbol, s.tf, s.strategy, s.candle_ts, s.side)


def signal_expires_at(s: Signal, valid_bars: int) -> int:
    """Сигнал известен после закрытия свечи (ts + tf) и актуален ещё valid_bars свечей."""
    return s.candle_ts + TIMEFRAME_MS[s.tf] * (1 + valid_bars)


def signal_status(
    s: Signal,
    now_ms: int,
    valid_bars: int,
    *,
    in_position: bool = True,
    stop_hit: bool = False,
) -> str:
    """dismissed — отклонён; invalidated — стратегия ушла или стоп уже пробит; expired — вышел срок; active."""
    if s.dismissed_at is not None:
        return "dismissed"
    if stop_hit or not in_position:
        return "invalidated"
    return "expired" if now_ms >= signal_expires_at(s, valid_bars) else "active"


def _row_to_state(r: tuple) -> StrategyState:
    return StrategyState(*r[:9], params=json.loads(r[9]) if r[9] else None, strategy_version=r[10], source=r[11])


def _state_key(st: StrategyState) -> tuple[str, str, str, str]:
    return (st.market, st.symbol, st.tf, st.strategy)


def load_signal_facts(store: SignalStore, journal, plans, now_ms: int, valid_bars: int) -> SignalFacts:
    """План и журнал читаются здесь, чтобы статус сигнала не смешивался с тем, что сделал пользователь."""
    from compass.plans import review

    states = {_state_key(st): st for st in store.strategy_states()}
    taken = journal.signal_ids() if journal is not None else set()
    planned = plans.signal_ids() if plans is not None else set()
    open_plans: set[int] = set()
    if plans is not None and journal is not None:
        for plan in plans.list(limit=1000):
            if plan.signal_id is None:
                continue
            entries = journal.list(plan.market, plan.symbol, mode=None)
            if review(plan, entries)["status"] != "closed":
                open_plans.add(plan.signal_id)
    held: set[tuple[str, str]] = set()
    if journal is not None:
        held = {(p.market, p.symbol) for p in journal.positions() if p.qty > 0}
    return SignalFacts(now_ms, valid_bars, states, taken, planned, open_plans, held, store.stop_hits())


def assess_signal(s: Signal, facts: SignalFacts) -> dict:
    """status — жизнь идеи; disposition — что сделал пользователь; role — звать ли к действию."""
    state = facts.states.get((s.market, s.symbol, s.tf, s.strategy))
    want = 1 if s.side == "buy" else 0
    in_position = state is None or (state.target == want and state.since_ts == s.candle_ts)
    stop_hit = s.id is not None and s.id in facts.stop_hits
    if s.id is not None and s.id in facts.taken:
        disposition = "taken"
    elif s.id is not None and s.id in facts.planned:
        disposition = "planned"
    else:
        disposition = "none"
    if s.side != "exit":
        role = "action"
    else:
        linked = s.entry_signal_id is not None and s.entry_signal_id in facts.open_plan_entries
        role = "action" if linked or (s.market, s.symbol) in facts.held else "note"
    return {
        "status": signal_status(s, facts.now_ms, facts.valid_bars, in_position=in_position, stop_hit=stop_hit),
        "disposition": disposition,
        "role": role,
        "in_position": in_position,
        "stop_hit": stop_hit,
    }


def in_quiet_hours(quiet: dict, now_ms: int, tz: tzinfo | None = None) -> bool:
    """Тихие часы по местному времени; окно может переходить через полночь (22:00–08:00)."""
    if not quiet.get("enabled"):
        return False
    local = datetime.fromtimestamp(now_ms / 1000, tz)
    now_min = local.hour * 60 + local.minute
    start = int(quiet["from"][:2]) * 60 + int(quiet["from"][3:])
    end = int(quiet["to"][:2]) * 60 + int(quiet["to"][3:])
    return start <= now_min < end if start < end else (now_min >= start or now_min < end)


class SignalEngine:
    def __init__(
        self,
        cache: CandleCache,
        watchlist: Watchlist,
        settings: Settings,
        store: SignalStore,
        notifier,
        now_ms: Callable[[], int] = lambda: int(time.time() * 1000),
        local_tz: tzinfo | None = None,
    ) -> None:
        self._cache, self._watchlist, self._settings = cache, watchlist, settings
        self._store, self._notifier, self._now_ms = store, notifier, now_ms
        self._tz = local_tz
        self._journal = None
        self._plans = None
        self._scan_lock = threading.Lock()  # ручной скан и фоновый не должны идти одновременно
        self.last_scan_at: int | None = None  # секунды UTC окончания последней проверки

    def bind_book(self, journal, plans) -> None:
        """Журнал и планы нужны, чтобы выход без позиции ушёл как заметка, а не как просьба продавать."""
        self._journal, self._plans = journal, plans

    def scan(self) -> ScanResult:
        with self._scan_lock:
            return self._scan()

    def _scan(self) -> ScanResult:
        cfg = self._settings.all()
        now = self._now_ms()
        now_s = now // 1000
        paused = set(cfg["paused_instruments"])
        new: list[Signal] = []
        errors: list[str] = []
        insts = self._watchlist.list()
        for inst in insts:
            tf = cfg.get(f"tf_{inst.market}")
            if tf is None:
                continue
            if profile_key(inst.market, inst.symbol) in paused:
                self._store.set_state(inst.market, inst.symbol, "paused", "Наблюдение приостановлено вами", now_s)
                continue
            try:
                result = self._cache.get(inst.market, inst.symbol, tf, HISTORY)
            except MarketError as e:
                errors.append(f"{inst.symbol}: {e}")
                self._store.set_state(inst.market, inst.symbol, "error", str(e)[:200], now_s)
                continue
            if result.stale:
                msg = (
                    "источник недоступен, свечи из кэша; "
                    "поиск новых сигналов приостановлен до обновления данных"
                )
                errors.append(f"{inst.symbol}: {msg}")
                self._store.set_state(inst.market, inst.symbol, "stale", msg, now_s)
                continue
            closed = closed_candles(result.candles, tf, now)
            if len(closed) < 3:
                self._store.set_state(inst.market, inst.symbol, "short", "Слишком мало закрытых свечей", now_s)
                continue
            df = candles_to_df(closed)
            band = atr(df, 14)
            try:
                chosen = _chosen_strategies(cfg, inst.market, inst.symbol)
            except ValueError as e:
                errors.append(f"{inst.symbol}: {e}")
                self._store.set_state(inst.market, inst.symbol, "error", str(e)[:200], now_s)
                continue
            for strat, params in chosen:
                new.extend(self._strategy_flips(
                    inst, tf, strat, params, df, band, result.candles, result.source or None, now_s,
                ))
            self._store.set_state(inst.market, inst.symbol, "ok", "", now_s)
        self._store.prune_states({(i.market, i.symbol) for i in insts})
        self.last_scan_at = now_s
        self._deliver(cfg, now, now_s, {_key(s) for s in new})
        return ScanResult(new, errors)

    def _strategy_flips(
        self, inst, tf: str, strat, params: dict, df, band, candles: Sequence[Candle], source: str | None, now_s: int,
    ) -> list[Signal]:
        version = strategy_version(strat, params)
        target = strat.target(df, params)
        state = self._store.strategy_state(inst.market, inst.symbol, tf, strat.id)
        changed = state is not None and (
            state.strategy_version != version or canonical_params(strat, state.params) != canonical_params(strat, params)
        )
        indexes = _flip_indexes(df, target, None if changed else state)
        open_buy = None
        if state is not None and not changed and state.target == 1:
            open_buy = self._store.buy_id(inst.market, inst.symbol, tf, strat.id, state.since_ts)
        fresh: list[Signal] = []
        deferred_last = False
        for i in indexes:
            cur = int(target.iloc[i])
            side = "buy" if cur == 1 else "exit"
            priced = _trade_price(inst.market, df, i, candles)
            if priced is None:
                deferred_last = i == len(df) - 1
                continue
            price, open_px, fill_at = priced
            direction = trade_direction(price, open_px, side)
            atr_value = None if math.isnan(band.iloc[i]) else float(band.iloc[i])
            stop, target_px, leverage, stake = _risk_stop(inst.market, price, open_px, atr_value, direction)
            if inst.market == "moex" and stop is None:
                continue
            sig = Signal(
                inst.market, inst.symbol, tf, strat.id, side, int(df["ts"].iloc[i]), price, stop,
                params=params, strategy_version=version, source=source,
                entry_signal_id=None if side == "buy" else open_buy,
                target=target_px, leverage=leverage, stake=stake, fill_at=fill_at,
                open_px=open_px, direction=direction,
            )
            new_id = self._store.insert(sig)
            if new_id is not None:
                stored = replace(sig, id=new_id)
                fresh.append(stored)
                open_buy = new_id if side == "buy" else None
            elif side == "buy":
                open_buy = self._store.buy_id(inst.market, inst.symbol, tf, strat.id, sig.candle_ts)
            else:
                open_buy = None
        snap_df, snap_target, snap_band = df, target, band
        if deferred_last and len(df) > 1:
            snap_df, snap_target, snap_band = df.iloc[:-1], target.iloc[:-1], band.iloc[:-1]
        self._store.save_strategy_state(
            _snapshot(inst, tf, strat.id, snap_df, snap_target, snap_band, params, version, source), now_s,
        )
        return fresh

    def _deliver(self, cfg: dict, now: int, now_s: int, new_keys: set[tuple]) -> None:
        """Внешние уведомления. В тихие часы сигналы только сохраняются; после них устаревшее не рассылается,
        а накопившееся уходит одним сообщением."""
        if in_quiet_hours(cfg["quiet_hours"], now, self._tz):
            return
        pending = self._store.pending_notification()
        if not pending:
            return
        valid = cfg["signal_valid_bars"]
        fresh = [s for s in pending if now < signal_expires_at(s, valid)]
        expired = [s for s in pending if s not in fresh]
        if expired:  # устаревший сигнал уже никому не нужен — помечаем, но не шлём
            self._store.mark_notified([s.id for s in expired if s.id is not None], now_s)
        if not fresh:
            return
        older = [s for s in fresh if _key(s) not in new_keys]  # накопились раньше, чем идёт этот скан
        facts = (
            load_signal_facts(self._store, self._journal, self._plans, now, valid) if self._journal is not None else None
        )
        outgoing = [replace(s, role=assess_signal(s, facts)["role"]) if facts is not None else s for s in fresh]
        if older and hasattr(self._notifier, "send_digest"):
            self._notifier.send_digest(outgoing)
        else:
            for s in outgoing:
                self._notifier.send(s)
        self._store.mark_notified([s.id for s in fresh if s.id is not None], now_s)


def _flip_indexes(df, target, state: StrategyState | None) -> list[int]:
    """Индексы свечей, на которых цель сменилась. Без состояния — только последняя закрытая свеча."""
    n = len(df)
    if state is None:
        return [n - 1] if int(target.iloc[-2]) != int(target.iloc[-1]) else []
    running = state.target
    found: list[int] = []
    for i in range(n):
        if int(df["ts"].iloc[i]) < state.last_ts:
            continue
        cur = int(target.iloc[i])
        if cur != running:
            found.append(i)
            running = cur
    return found


def trade_direction(price: float, open_px: float, strategy_side: str) -> str:
    """Сигнал ниже цены открытия — шорт, выше — лонг."""
    if price < open_px:
        return "short"
    if price > open_px:
        return "long"
    return "short" if strategy_side == "exit" else "long"


def atr_stop(price: float, atr_value: float, open_px: float, direction: str) -> float | None:
    """Стоп риска потери: у лонга ниже открытия, у шорта выше."""
    if not math.isfinite(price) or price <= 0 or not math.isfinite(atr_value) or atr_value <= 0:
        return None
    if direction == "short":
        stop = round(open_px + ATR_STOP_MULT * atr_value, 8)
        if stop <= open_px or stop <= price:
            return None
        return stop
    stop = round(open_px - ATR_STOP_MULT * atr_value, 8)
    if stop <= 0 or stop >= open_px or stop >= price:
        return None
    return stop


def _next_open(df, i: int, candles: Sequence[Candle]) -> float | None:
    if i + 1 < len(df):
        return float(df["open"].iloc[i + 1])
    ts = int(df["ts"].iloc[i])
    later = [c for c in candles if c.ts > ts]
    if not later:
        return None
    return float(min(later, key=lambda c: c.ts).open)


def _trade_price(market: str, df, i: int, candles: Sequence[Candle]) -> tuple[float, float, str | None] | None:
    open_px = float(df["open"].iloc[i])
    close = float(df["close"].iloc[i])
    if market != "moex":
        return close, open_px, None
    opened = _next_open(df, i, candles)
    if opened is None:
        return None
    return opened, open_px, "next_open"


def _risk_stop(
    market: str, price: float, open_px: float, atr_value: float | None, direction: str,
) -> tuple[float | None, float | None, float | None, float | None]:
    if atr_value is None or not math.isfinite(atr_value) or atr_value <= 0:
        return None, None, None, None
    if market == "crypto":
        plan = swing_plan(price, atr_value, open_price=open_px, direction=direction)
        if plan is not None:
            return plan.stop, plan.target, plan.leverage, plan.stake
    return atr_stop(price, atr_value, open_px, direction), None, None, None


def _stop_at(df, band, i: int, side: str) -> float | None:
    open_px = float(df["open"].iloc[i])
    price = float(df["close"].iloc[i])
    if math.isnan(band.iloc[i]):
        return None
    direction = trade_direction(price, open_px, side)
    return atr_stop(price, float(band.iloc[i]), open_px, direction)


def _since_index(target, end: int) -> int:
    cur = int(target.iloc[end])
    i = end
    while i > 0 and int(target.iloc[i - 1]) == cur:
        i -= 1
    return i


def _snapshot(inst, tf: str, strategy: str, df, target, band, params: dict, version: str, source: str | None) -> StrategyState:
    end = len(df) - 1
    since_i = _since_index(target, end)
    cur = int(target.iloc[end])
    price = float(df["close"].iloc[since_i])
    return StrategyState(
        inst.market, inst.symbol, tf, strategy, cur, int(df["ts"].iloc[since_i]), int(df["ts"].iloc[end]),
        price, _stop_at(df, band, since_i, "buy" if cur == 1 else "exit"), params, version, source,
    )


def _chosen_strategies(cfg: dict, market: str, symbol: str) -> list[tuple]:
    """Своя стратегия тикера. Если её нет — одна стратегия по умолчанию, либо все, если это явно включено."""
    raw = cfg["instrument_strategies"].get(profile_key(market, symbol))
    if raw:
        strat = STRATEGIES[raw["strategy"]]
        return [(strat, strat.resolve({k: int(v) for k, v in raw["params"].items()}))]
    if cfg.get("scan_all_strategies"):
        return [(s, s.resolve()) for s in STRATEGIES.values()]
    strat = STRATEGIES[cfg["default_strategy"]]
    return [(strat, strat.resolve())]
