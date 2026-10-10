"""Сессии симуляции фьючерсов: повтор истории на движке `futures_sim` с сохранением в базе.

Свечи заморожены копией при создании сессии (позднейшие правки источника её не меняют), клиент видит
только уже «открытые» свечи (`cursor`), будущее не покидает сервер. Состояние счёта хранится снимком,
каждое событие (заявка, сделка, ликвидация, фандинг) дописывается в неизменяемый журнал. Сессия не
попадает в журнал реальных сделок, панель дня и статистику счетов.

Фандинг: если биржа отдала историю ставок — берётся она, иначе каждые 8 часов (00:00, 08:00, 16:00 UTC)
начисляется условная ставка 0,01% — это оценка, и источник помечен в сессии (`funding_source`). Цены —
свечи спота: у бессрочного контракта они отличаются на величину базиса.

Тот же интерфейс (`order`, `cancel`, `close`, `stops`, `leverage`, `step`) потом получат агенты."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from compass.db import Connection
from compass.futures_sim import FuturesSim, SimConfig, SimError
from compass.models import TIMEFRAME_MS
from compass.replay import MIN_REPLAY, MIN_TRADES_FOR_STATS, MIN_WARMUP, Bar

FUNDING_INTERVAL_MS = 8 * 3_600_000
ESTIMATED_FUNDING_RATE = 0.0001  # 0,01% за 8 часов — типичная нейтральная ставка
MAX_STEP = 500


class SimSessionError(SimError):
    """Ошибка действия в сессии симуляции (по-русски, показывается пользователю)."""


def funding_for_bar(bar: Bar, tf_ms: int, history: list[tuple[int, float]], source: str) -> float | None:
    """Суммарная ставка фандинга, выпавшая на интервал свечи [ts, ts + tf). None — начислений нет."""
    end = bar.ts + tf_ms
    if source == "estimate":
        n = (end - 1) // FUNDING_INTERVAL_MS - (bar.ts - 1) // FUNDING_INTERVAL_MS
        return ESTIMATED_FUNDING_RATE * n if n > 0 else None
    total = sum(r for t, r in history if bar.ts <= t < end)
    return total or None


@dataclass
class SimSession:
    id: int
    uid: str
    created_at: int
    owner: str
    market: str
    symbol: str
    tf: str
    source: str
    start_index: int
    cursor: int  # индекс последней открытой свечи
    status: str
    data_hash: str
    funding_source: str
    bars: list[Bar]
    funding: list[tuple[int, float]]
    sim: FuturesSim
    curve: list[tuple[int, float]] = field(default_factory=list)  # капитал на закрытии каждой открытой свечи
    pending_log: list[dict[str, Any]] = field(default_factory=list)  # ещё не записанные события

    # ---- чтение ----

    @property
    def visible(self) -> list[Bar]:
        return self.bars[: self.cursor + 1]

    @property
    def remaining(self) -> int:
        return len(self.bars) - 1 - self.cursor

    def _active(self) -> None:
        if self.status != "active":
            raise SimSessionError("Сессия завершена: новые заявки и шаги невозможны")

    def _note(self, type_: str, **data: Any) -> None:
        self.pending_log.append({"ts": self.sim.ts, "type": type_, **data})

    # ---- действия (общий интерфейс для окна торговли и агентов) ----

    def order(self, **kw: Any) -> dict[str, Any]:
        self._active()
        o = self.sim.place_order(**kw)
        self._note("order", order_id=o.id, **{k: v for k, v in kw.items() if v is not None})
        return {"order_id": o.id}

    def cancel(self, order_id: int) -> None:
        self._active()
        self.sim.cancel(order_id)
        self._note("cancel", order_id=order_id)

    def close(self) -> dict[str, Any]:
        self._active()
        o = self.sim.close_position()
        self._note("close_position", order_id=o.id)
        return {"order_id": o.id}

    def stops(self, sl: float | None, tp: float | None) -> None:
        self._active()
        self.sim.set_stops(sl, tp)
        self._note("set_stops", sl=sl, tp=tp)

    def leverage(self, value: float) -> None:
        self._active()
        self.sim.set_leverage(value)
        self._note("set_leverage", leverage=value)

    def step(self, n: int = 1) -> list[dict[str, Any]]:
        """Открыть следующие n свечей; возвращает события (сделки, ликвидации, фандинг)."""
        self._active()
        if not 1 <= n <= MAX_STEP:
            raise SimSessionError(f"Шагов за раз: от 1 до {MAX_STEP}")
        if self.remaining <= 0:
            raise SimSessionError("Данные закончились: сессию можно только завершить")
        tf_ms = TIMEFRAME_MS[self.tf]
        events: list[dict[str, Any]] = []
        for _ in range(n):
            if self.remaining <= 0:
                break
            self.cursor += 1
            bar = self.bars[self.cursor]
            rate = funding_for_bar(bar, tf_ms, self.funding, self.funding_source)
            events += self.sim.on_bar(bar, funding_rate=rate)
            self.curve.append((bar.ts, self.sim.equity(bar.c)))
        if self.remaining <= 0:
            left = self.sim.cancel_all()
            if left:
                events.append({"ts": self.sim.ts, "type": "cancelled_all", "count": left,
                               "reason": "последняя свеча открыта: заявки, не успевшие исполниться, сняты"})
            self.status = "finished"
        self.pending_log += events
        return events

    # ---- итог ----

    def result(self) -> dict[str, Any]:
        cfg = self.sim.cfg
        start_close = self.bars[self.start_index].c
        eq = [cfg.capital, *(v for _, v in self.curve)]
        peak, dd = eq[0], 0.0
        for v in eq:
            peak = max(peak, v)
            dd = min(dd, v / peak - 1)
        fills = self.sim.fills
        closed = [f for f in fills if f.reason in ("sl", "tp", "liquidation") or f.pnl != 0]
        wins = sum(1 for f in closed if f.pnl - f.fee > 0)
        equity = eq[-1]
        return {
            "equity": round(equity, 2),
            "return_pct": round((equity / cfg.capital - 1) * 100, 2),
            "buy_hold_pct": round((self.visible[-1].c / start_close - 1) * 100, 2),
            "max_drawdown_pct": round(dd * 100, 2),
            "fills": len(fills),
            "closed_trades": len(closed),
            "win_rate_pct": round(wins / len(closed) * 100, 1) if len(closed) >= MIN_TRADES_FOR_STATS else None,
            "fees": round(sum(f.fee for f in fills), 2),
            "funding_paid": round(self.sim.funding_total, 2),
            "liquidations": sum(1 for f in fills if f.reason == "liquidation"),
            "note": (
                None if len(closed) >= MIN_TRADES_FOR_STATS
                else f"Закрытых сделок {len(closed)}: меньше {MIN_TRADES_FOR_STATS} — доля прибыльных не показывается, "
                     "выводов об умении делать нельзя."
            ),
        }


_COLS = (
    "id, uid, created_at, owner, market, symbol, tf, source, start_index, cursor, status, data_hash, "
    "funding_source, candles, funding, state, curve"
)


class SimStore:
    def __init__(self, conn: Connection) -> None:
        self._conn = conn
        self._lock = conn.lock

    def create(
        self, *, market: str, symbol: str, tf: str, source: str, cfg: SimConfig, bars: list[Bar], start_index: int,
        data_hash: str, funding: list[tuple[int, float]], funding_source: str, owner: str = "user",
    ) -> SimSession:
        if tf not in TIMEFRAME_MS:
            raise SimSessionError("Таймфрейм не поддерживается")
        if start_index < MIN_WARMUP - 1 or len(bars) - 1 - start_index < MIN_REPLAY:
            raise SimSessionError(
                f"Нужно хотя бы {MIN_WARMUP} свечей истории до начала и {MIN_REPLAY} свечей для воспроизведения"
            )
        sim = FuturesSim.start(cfg, bars[start_index].c, bars[start_index].ts)
        uid = uuid.uuid4().hex
        with self._lock, self._conn:
            cur = self._conn.execute(
                f"INSERT INTO sim_sessions ({_COLS.replace('id, ', '', 1)}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (uid, int(time.time()), owner, market, symbol, tf, source, start_index, start_index, "active", data_hash,
                 funding_source, json.dumps([[b.ts, b.o, b.h, b.low, b.c, b.v] for b in bars]),
                 json.dumps([[t, r] for t, r in funding]), json.dumps(sim.snapshot()), "[]"),
            )
        s = self.get(int(cur.lastrowid))  # type: ignore[arg-type]
        assert s is not None
        return s

    def get(self, session_id: int) -> SimSession | None:
        with self._lock:
            row = self._conn.execute(f"SELECT {_COLS} FROM sim_sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return None
        (id_, uid, created, owner, market, symbol, tf, source, start, cursor, status, dh, fsrc,
         candles, funding, state, curve) = row
        return SimSession(
            id_, uid, created, owner, market, symbol, tf, source, start, cursor, status, dh, fsrc,
            [Bar(*c) for c in json.loads(candles)], [(int(t), float(r)) for t, r in json.loads(funding)],
            FuturesSim.restore(json.loads(state)), [(int(t), float(v)) for t, v in json.loads(curve)],
        )

    def list(self, owner: str | None = None) -> list[dict[str, Any]]:
        sql = ("SELECT id, created_at, owner, market, symbol, tf, status, cursor, start_index, "
               "json_array_length(candles) FROM sim_sessions")
        with self._lock:
            rows = self._conn.execute(
                sql + (" WHERE owner = ?" if owner else "") + " ORDER BY id DESC LIMIT 100", (owner,) if owner else ()
            ).fetchall()
        keys = ("id", "created_at", "owner", "market", "symbol", "tf", "status", "cursor", "start_index", "total")
        out = []
        for r in rows:
            d = dict(zip(keys, r, strict=True))
            d["replayed"] = d["cursor"] - d["start_index"]
            d["remaining"] = d["total"] - 1 - d["cursor"]
            del d["cursor"], d["start_index"], d["total"]
            out.append(d)
        return out

    def save(self, s: SimSession) -> None:
        """Записывает состояние и дописывает накопленные события в журнал одной транзакцией."""
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE sim_sessions SET cursor = ?, status = ?, state = ?, curve = ? WHERE id = ?",
                (s.cursor, s.status, json.dumps(s.sim.snapshot()), json.dumps([[t, v] for t, v in s.curve]), s.id),
            )
            for e in s.pending_log:
                self._conn.execute(
                    "INSERT INTO sim_log (session_id, ts, type, data) VALUES (?,?,?,?)",
                    (s.id, int(e["ts"]), e["type"], json.dumps(e, ensure_ascii=False)),
                )
        s.pending_log = []

    def finish(self, s: SimSession) -> None:
        if s.status == "active":
            s.status = "finished"
            s._note("finished")
            self.save(s)

    def log(self, session_id: int, after_id: int = 0, limit: int = 500) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, data FROM sim_log WHERE session_id = ? AND id > ? ORDER BY id LIMIT ?",
                (session_id, after_id, limit),
            ).fetchall()
        return [{"id": i, **json.loads(d)} for i, d in rows]
