"""Движок симуляции USDT-фьючерсов: счёт, позиция с плечом, заявки, ликвидация, фандинг.

Чистая логика без базы и интерфейса: окно торговли, учебный повтор истории и (позже) агенты работают
через одни и те же методы. Время — миллисекунды, как у свечей; будущего движок не видит: он получает
свечи по одной через `on_bar`, а заявки, поставленные между свечами, исполняются начиная со следующей.

Модель (односторонний режим, один инструмент, изолированная маржа):
- одна чистая позиция; встречная заявка сначала закрывает её, остаток разворачивает позицию;
- маржа позиции = стоимость входа / плечо; ликвидация по цене, где остаток маржи равен поддерживающей;
  при ликвидации теряется вся маржа позиции, отрицательного баланса не бывает;
- заявки: рыночная, лимитная, стоп (триггер → рыночная), «только закрытие» (reduce_only);
  у позиции есть стоп-лосс (триггер) и тейк-профит (лимит), оба на всю позицию;
- у открывающей заявки резервируется маржа и комиссия: деньги нельзя потратить дважды.

Правила внутри свечи консервативные, потому что OHLCV не говорит, что было раньше:
1. сначала рыночные заявки (по открытию); 2. убыточные события — стоп-лосс и ликвидация — в порядке
от входа вглубь против позиции; 3. стоп-входы; 4. лимитные заявки и тейк-профит.
Лимитная заявка исполняется, только если цена прошла СКВОЗЬ уровень (касания мало — очередь не
моделируется); гэп через лимит исполняется по открытию (лучше уровня), через стоп — по открытию (хуже).
Тейк-профит не исполняется на той же свече, где позиция открыта (порядок внутри свечи неизвестен), а
стоп-лосс — исполняется. Если стоп стоит дальше цены ликвидации, раньше сработает ликвидация.

Не моделируется: стакан и очередь, частичные исполнения, ADL и страховой фонд, кросс-маржа, режим
хеджа, ступенчатые требования к марже по размеру позиции, разница между ценой сделки и маркировочной."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from compass.replay import Bar

EPS = 1e-12
MAX_STEPS = 64  # предохранитель цикла разбора одной свечи


class SimError(ValueError):
    """Ошибка действия в симуляции (по-русски, показывается пользователю)."""


@dataclass(frozen=True, slots=True)
class SimConfig:
    capital: float
    leverage: float = 1.0
    maker_fee_pct: float = 0.02
    taker_fee_pct: float = 0.05
    slippage_pct: float = 0.02
    spread_pct: float = 0.0
    maint_margin_pct: float = 0.5
    max_leverage: float = 100.0

    def check(self) -> None:
        if not math.isfinite(self.capital) or self.capital <= 0:
            raise SimError("Капитал должен быть больше нуля")
        for name, v in (
            ("Комиссия мейкера", self.maker_fee_pct), ("Комиссия тейкера", self.taker_fee_pct),
            ("Проскальзывание", self.slippage_pct), ("Спред", self.spread_pct),
        ):
            if not math.isfinite(v) or not 0 <= v < 100:
                raise SimError(f"{name}: от 0 до 100%")
        if not math.isfinite(self.maint_margin_pct) or not 0 < self.maint_margin_pct < 50:
            raise SimError("Поддерживающая маржа: больше 0 и меньше 50%")
        if not 1 <= self.max_leverage <= 500 or not 1 <= self.leverage <= self.max_leverage:
            raise SimError(f"Плечо: от 1 до {self.max_leverage:g}")

    @property
    def slip(self) -> float:
        return (self.slippage_pct + self.spread_pct / 2) / 100


@dataclass(slots=True)
class Position:
    dir: int  # 1 — лонг, -1 — шорт
    qty: float
    entry: float
    margin: float
    leverage: float
    opened_ts: int
    liq_price: float = 0.0


@dataclass(slots=True)
class Order:
    id: int
    ts: int
    side: str  # buy | sell
    qty: float  # 0 при close_all: размер берётся из позиции в момент исполнения
    kind: str  # market | limit | stop
    price: float | None = None  # лимитная цена
    trigger: float | None = None
    trigger_dir: int = 0  # 1 — сработает при росте до триггера, -1 — при падении
    reduce_only: bool = False
    close_all: bool = False
    reserved: float = 0.0  # зарезервированные маржа и комиссия
    marketable: bool = False  # лимитная заявка, которая на момент постановки готова исполниться по рынку
    sl: float | None = None  # вложенные стоп и цель: ставятся после исполнения входа
    tp: float | None = None
    tag: str = ""  # sl | tp — стоп и цель позиции
    note: str | None = None

    @property
    def d(self) -> int:
        return 1 if self.side == "buy" else -1


@dataclass(frozen=True, slots=True)
class Fill:
    ts: int
    order_id: int
    side: str
    qty: float
    price: float
    fee: float
    reason: str  # market | limit | stop | sl | tp | liquidation
    pnl: float  # реализованный результат закрытой части (до комиссии), 0 для открытия
    pos_qty: float  # позиция после сделки, со знаком (лонг +, шорт −)
    maker: bool = False


@dataclass(slots=True)
class FuturesSim:
    cfg: SimConfig
    last_price: float
    cash: float = 0.0  # свободные деньги плюс резерв под заявки; маржа позиции учитывается отдельно
    pos: Position | None = None
    orders: list[Order] = field(default_factory=list)
    fills: list[Fill] = field(default_factory=list)
    next_id: int = 1
    funding_total: float = 0.0  # сколько заплачено (+) или получено (−) за всё время
    ts: int = 0
    leverage: float = 1.0

    @classmethod
    def start(cls, cfg: SimConfig, last_price: float, ts: int = 0) -> FuturesSim:
        cfg.check()
        if not math.isfinite(last_price) or last_price <= 0:
            raise SimError("Нужна начальная цена больше нуля")
        return cls(cfg=cfg, last_price=last_price, cash=cfg.capital, ts=ts, leverage=cfg.leverage)

    # ---- состояние счёта ----

    @property
    def reserved(self) -> float:
        return sum(o.reserved for o in self.orders)

    @property
    def available(self) -> float:
        return self.cash - self.reserved

    def unrealized(self, mark: float | None = None) -> float:
        p = self.pos
        return 0.0 if p is None else p.qty * ((self.last_price if mark is None else mark) - p.entry) * p.dir

    def equity(self, mark: float | None = None) -> float:
        p = self.pos
        return self.cash + (0.0 if p is None else p.margin + self.unrealized(mark))

    def view(self) -> dict[str, Any]:
        p = self.pos
        return {
            "ts": self.ts, "last_price": self.last_price, "leverage": self.leverage,
            "cash": round(self.cash, 4), "available": round(self.available, 4), "reserved": round(self.reserved, 4),
            "equity": round(self.equity(), 4), "unrealized": round(self.unrealized(), 4),
            "funding_total": round(self.funding_total, 6),
            "position": None if p is None else {
                "side": "long" if p.dir > 0 else "short", "qty": p.qty, "entry": p.entry, "margin": round(p.margin, 4),
                "leverage": p.leverage, "liq_price": p.liq_price, "opened_ts": p.opened_ts,
                "notional": round(p.qty * self.last_price, 4),
            },
            "orders": [asdict(o) for o in self.orders],
        }

    # ---- действия ----

    def set_leverage(self, leverage: float) -> None:
        if not math.isfinite(leverage) or not 1 <= leverage <= self.cfg.max_leverage:
            raise SimError(f"Плечо: от 1 до {self.cfg.max_leverage:g}")
        if self.pos is not None:
            raise SimError("Плечо можно менять только без открытой позиции")
        if any(not o.reduce_only for o in self.orders):
            raise SimError("Плечо можно менять только без заявок на вход: сначала отмените их")
        self.leverage = float(leverage)

    def place_order(
        self, *, side: str, qty: float, kind: Literal["market", "limit", "stop"] = "market",
        price: float | None = None, trigger: float | None = None, reduce_only: bool = False,
        sl: float | None = None, tp: float | None = None,
    ) -> Order:
        if side not in ("buy", "sell"):
            raise SimError("Сторона: buy или sell")
        if kind not in ("market", "limit", "stop"):
            raise SimError("Тип заявки: market, limit или stop")
        if not math.isfinite(qty) or qty <= 0:
            raise SimError("Количество должно быть больше нуля")
        d = 1 if side == "buy" else -1
        pos = self.pos
        if reduce_only and (pos is None or pos.dir == d):
            raise SimError("Заявка «только закрытие»: у вас нет позиции, которую она закрывала бы")
        o = Order(self.next_id, self.ts, side, qty, kind, reduce_only=reduce_only)
        est = self.last_price
        if kind == "limit":
            if price is None or not math.isfinite(price) or price <= 0:
                raise SimError("Для лимитной заявки нужна цена больше нуля")
            o.price = est = price
            o.marketable = price >= self.last_price if d > 0 else price <= self.last_price
        elif kind == "stop":
            if trigger is None or not math.isfinite(trigger) or trigger <= 0:
                raise SimError("Для стоп-заявки нужен триггер больше нуля")
            if trigger == self.last_price:
                raise SimError("Триггер совпадает с текущей ценой: используйте рыночную заявку")
            o.trigger, o.trigger_dir, est = trigger, (1 if trigger > self.last_price else -1), trigger
        if (sl is not None or tp is not None) and reduce_only:
            raise SimError("Стоп и цель задаются у заявки на вход, а не «только закрытие»")
        self._check_stops(d, est, sl, tp)
        o.sl, o.tp = sl, tp
        if not reduce_only:
            need = self._reserve_for(o, est)
            if need > self.available + 1e-9:
                raise SimError(
                    f"Не хватает свободных денег: нужно {need:.2f} (маржа и комиссия), свободно {self.available:.2f}"
                )
            o.reserved = need
        self.next_id += 1
        self.orders.append(o)
        return o

    def close_position(self) -> Order:
        """Закрыть всю позицию рыночной заявкой «только закрытие» (исполнится на следующей свече)."""
        pos = self.pos
        if pos is None:
            raise SimError("Позиции нет")
        o = Order(self.next_id, self.ts, "sell" if pos.dir > 0 else "buy", 0.0, "market", reduce_only=True, close_all=True)
        self.next_id += 1
        self.orders.append(o)
        return o

    def set_stops(self, sl: float | None, tp: float | None) -> None:
        """Стоп-лосс и тейк-профит на всю позицию. Заменяет прежние; None снимает."""
        pos = self.pos
        if pos is None:
            raise SimError("Позиции нет: стоп и цель ставятся у позиции")
        self._check_stops(pos.dir, self.last_price, sl, tp)
        self._put_stops(pos, sl, tp)

    def cancel(self, order_id: int) -> None:
        for o in self.orders:
            if o.id == order_id:
                self.orders.remove(o)
                return
        raise SimError("Заявка не найдена: возможно, она уже исполнена или отменена")

    def cancel_all(self) -> int:
        n = len(self.orders)
        self.orders.clear()
        return n

    # ---- ход времени ----

    def on_bar(self, bar: Bar, funding_rate: float | None = None) -> list[dict[str, Any]]:
        """Открывается новая свеча. funding_rate — ставка фандинга, начисляемая на открытии (доля, 0.0001 = 0.01%)."""
        if bar.ts <= self.ts and self.ts:
            raise SimError("Свеча не новее предыдущей")
        ev: list[dict[str, Any]] = []
        self.ts = bar.ts
        if funding_rate and self.pos is not None:
            p = self.pos
            pay = p.qty * bar.o * funding_rate * p.dir  # положительная ставка: лонги платят шортам
            p.margin -= pay
            self.funding_total += pay
            self._liq_price(p)
            ev.append({"ts": bar.ts, "type": "funding", "rate": funding_rate, "payment": round(pay, 6)})
        for _ in range(MAX_STEPS):
            if not self._step(bar, ev):
                break
        for o in self.orders:
            o.marketable = False
        self.last_price = bar.c
        return ev

    # ---- внутреннее: проверки ----

    def _check_stops(self, d: int, est: float, sl: float | None, tp: float | None) -> None:
        for name, v in (("Стоп", sl), ("Цель", tp)):
            if v is not None and (not math.isfinite(v) or v <= 0):
                raise SimError(f"{name}: цена больше нуля")
        if sl is not None and (sl >= est if d > 0 else sl <= est):
            raise SimError("Стоп-лосс должен быть " + ("ниже" if d > 0 else "выше") + f" цены входа ({est:g})")
        if tp is not None and (tp <= est if d > 0 else tp >= est):
            raise SimError("Тейк-профит должен быть " + ("выше" if d > 0 else "ниже") + f" цены входа ({est:g})")

    def _reserve_for(self, o: Order, est: float) -> float:
        pos = self.pos
        d = o.d
        new_qty = o.qty - (pos.qty if pos is not None and pos.dir != d else 0.0)
        if new_qty <= EPS:
            return 0.0
        return new_qty * est / self.leverage + new_qty * est * self.cfg.taker_fee_pct / 100

    def _liq_price(self, p: Position) -> None:
        m = self.cfg.maint_margin_pct / 100
        if p.dir > 0:
            p.liq_price = max(0.0, (p.qty * p.entry - p.margin) / (p.qty * (1 - m)))
        else:
            p.liq_price = (p.qty * p.entry + p.margin) / (p.qty * (1 + m))

    def _put_stops(self, pos: Position, sl: float | None, tp: float | None) -> None:
        self.orders = [o for o in self.orders if o.tag not in ("sl", "tp")]
        side = "sell" if pos.dir > 0 else "buy"
        if sl is not None:
            self.orders.append(Order(
                self.next_id, self.ts, side, 0.0, "stop", trigger=sl, trigger_dir=-pos.dir,
                reduce_only=True, close_all=True, tag="sl",
            ))
            self.next_id += 1
        if tp is not None:
            self.orders.append(Order(
                self.next_id, self.ts, side, 0.0, "limit", price=tp, reduce_only=True, close_all=True, tag="tp",
            ))
            self.next_id += 1

    # ---- внутреннее: разбор свечи ----

    def _loss_close(self, o: Order, pos: Position) -> bool:
        return o.reduce_only and o.kind == "stop" and o.trigger_dir == -pos.dir

    def _step(self, bar: Bar, ev: list[dict[str, Any]]) -> bool:
        for o in self.orders:
            if o.kind == "market":
                self._execute(o, bar.o * (1 + o.d * self.cfg.slip), True, bar, ev)
                return True
        pos = self.pos
        if pos is not None:
            cands: list[tuple[float, Order | None]] = [(pos.liq_price, None)]
            cands += [(o.trigger or 0.0, o) for o in self.orders if self._loss_close(o, pos)]
            cands.sort(key=lambda c: -c[0] * pos.dir)  # ближайшее ко входу — первым
            for level, o in cands:
                if o is None:
                    if (bar.low <= level) if pos.dir > 0 else (bar.h >= level):
                        self._liquidate(pos, level, bar, ev)
                        return True
                else:
                    hit = self._hit(o, bar)
                    if hit is not None:
                        self._execute(o, hit[0], hit[1], bar, ev)
                        return True
        for o in self.orders:
            if o.kind == "stop" and not o.reduce_only:
                hit = self._hit(o, bar)
                if hit is not None:
                    self._execute(o, hit[0], hit[1], bar, ev)
                    return True
        for o in self.orders:
            if o.kind == "limit" or (o.kind == "stop" and o.reduce_only and not (pos and self._loss_close(o, pos))):
                if o.reduce_only and pos is not None and pos.opened_ts == bar.ts:
                    continue  # порядок внутри свечи неизвестен: цель не исполняется на свече входа
                hit = self._hit(o, bar)
                if hit is not None:
                    self._execute(o, hit[0], hit[1], bar, ev)
                    return True
        return False

    def _hit(self, o: Order, bar: Bar) -> tuple[float, bool] | None:
        """Цена и признак «тейкер», если заявка исполняется на этой свече, иначе None."""
        s = self.cfg.slip
        d = o.d
        if o.kind == "stop":
            t = o.trigger or 0.0
            if o.trigger_dir > 0:
                base = bar.o if bar.o >= t else (t if bar.h >= t else None)
            else:
                base = bar.o if bar.o <= t else (t if bar.low <= t else None)
            return None if base is None else (base * (1 + d * s), True)
        p = o.price or 0.0
        if d > 0:
            if bar.o <= p:
                return (min(bar.o * (1 + s), p), True) if o.marketable else (bar.o, False)
            return (p, False) if bar.low < p else None
        if bar.o >= p:
            return (max(bar.o * (1 - s), p), True) if o.marketable else (bar.o, False)
        return (p, False) if bar.h > p else None

    def _execute(self, o: Order, price: float, taker: bool, bar: Bar, ev: list[dict[str, Any]]) -> None:
        self.orders.remove(o)
        d = o.d
        pos = self.pos
        qty = pos.qty if o.close_all and pos is not None else o.qty
        reason = o.tag or ("market" if o.kind == "market" else "limit" if o.kind == "limit" else "stop")
        if o.reduce_only:
            if pos is None or pos.dir == d:
                ev.append({"ts": bar.ts, "type": "cancelled", "order_id": o.id, "reason": "позиции уже нет"})
                return
            qty = min(qty, pos.qty)
        rate = (self.cfg.taker_fee_pct if taker else self.cfg.maker_fee_pct) / 100
        close_q = min(qty, pos.qty) if pos is not None and pos.dir != d else 0.0
        open_q = 0.0 if o.reduce_only else qty - close_q
        pnl = 0.0
        fee_total = 0.0
        if close_q > EPS and pos is not None:
            pnl = close_q * (price - pos.entry) * pos.dir
            released = pos.margin * close_q / pos.qty
            fee = close_q * price * rate
            fee_total += fee
            net = released + pnl - fee
            if net < 0:
                ev.append({"ts": bar.ts, "type": "bankrupt", "order_id": o.id, "loss": round(-net, 4)})
            self.cash += max(net, 0.0)
            pos.margin -= released
            pos.qty -= close_q
            if pos.qty <= EPS:
                self.pos = None
                self.orders = [x for x in self.orders if not x.reduce_only]
            else:
                self._liq_price(pos)
        if open_q > EPS:
            margin = open_q * price / self.leverage
            fee = open_q * price * rate
            if margin + fee > self.available + 1e-9:
                ev.append({"ts": bar.ts, "type": "rejected", "order_id": o.id, "reason": "на исполнении не хватило денег"})
                open_q = 0.0
            else:
                self.cash -= margin + fee
                fee_total += fee
                cur = self.pos
                if cur is None:
                    cur = self.pos = Position(d, open_q, price, margin, self.leverage, bar.ts)
                else:
                    total = cur.qty + open_q
                    cur.entry = (cur.entry * cur.qty + price * open_q) / total
                    cur.qty, cur.margin = total, cur.margin + margin
                self._liq_price(cur)
                if o.sl is not None or o.tp is not None:
                    try:
                        self._check_stops(cur.dir, price, o.sl, o.tp)
                        self._put_stops(cur, o.sl, o.tp)
                    except SimError as e:
                        ev.append({"ts": bar.ts, "type": "stops_skipped", "order_id": o.id, "reason": str(e)})
        done = close_q + open_q
        if done > EPS:
            after = 0.0 if self.pos is None else self.pos.qty * self.pos.dir
            f = Fill(bar.ts, o.id, o.side, done, price, fee_total, reason, pnl, after, not taker)
            self.fills.append(f)
            ev.append({"ts": bar.ts, "type": "fill", **asdict(f)})

    def _liquidate(self, pos: Position, level: float, bar: Bar, ev: list[dict[str, Any]]) -> None:
        price = bar.o if (bar.o <= level if pos.dir > 0 else bar.o >= level) else level
        side = "sell" if pos.dir > 0 else "buy"
        f = Fill(bar.ts, 0, side, pos.qty, price, 0.0, "liquidation", -pos.margin, 0.0)
        self.fills.append(f)
        ev.append({"ts": bar.ts, "type": "liquidation", **asdict(f)})
        self.pos = None
        self.orders = [x for x in self.orders if not x.reduce_only]

    # ---- сохранение ----

    def snapshot(self) -> dict[str, Any]:
        return {
            "cfg": asdict(self.cfg), "last_price": self.last_price, "cash": self.cash,
            "pos": None if self.pos is None else asdict(self.pos),
            "orders": [asdict(o) for o in self.orders], "fills": [asdict(f) for f in self.fills],
            "next_id": self.next_id, "funding_total": self.funding_total, "ts": self.ts, "leverage": self.leverage,
        }

    @classmethod
    def restore(cls, data: dict[str, Any]) -> FuturesSim:
        return cls(
            cfg=SimConfig(**data["cfg"]), last_price=data["last_price"], cash=data["cash"],
            pos=None if data["pos"] is None else Position(**data["pos"]),
            orders=[Order(**o) for o in data["orders"]], fills=[Fill(**f) for f in data["fills"]],
            next_id=data["next_id"], funding_total=data["funding_total"], ts=data["ts"], leverage=data["leverage"],
        )
