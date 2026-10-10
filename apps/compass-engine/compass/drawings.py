"""Рисунки на графике: уровни, тренды, зоны и линейка в координатах время+цена."""

from __future__ import annotations

import json
import math
import time
import uuid
from dataclasses import dataclass, replace
from typing import Any

from compass.db import Connection

MAX_PER_INSTRUMENT = 100
KINDS = frozenset({"hline", "trend", "rect", "ruler", "vline", "ray", "fib", "arrow", "text", "channel"})
ONE_POINT = frozenset({"hline", "vline", "text"})


@dataclass(frozen=True, slots=True)
class DrawingPoint:
    t: int  # мс UTC
    price: float


@dataclass(frozen=True, slots=True)
class Drawing:
    market: str
    symbol: str
    kind: str
    points: tuple[DrawingPoint, ...]
    label: str = ""
    locked: bool = False
    visible_tfs: tuple[str, ...] | None = None  # None — на всех таймфреймах
    id: int | None = None
    uid: str | None = None
    created_at: int | None = None
    updated_at: int | None = None
    deleted_at: int | None = None


_COLS = "market, symbol, kind, points, label, locked, visible_tfs, id, uid, created_at, updated_at, deleted_at"


def _points_to_json(points: tuple[DrawingPoint, ...]) -> str:
    return json.dumps([{"t": p.t, "price": p.price} for p in points], separators=(",", ":"))


def _points_from_json(raw: str) -> tuple[DrawingPoint, ...]:
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("Некорректные точки рисунка")  # noqa: TRY004 — 400 для клиента, как остальные ошибки данных
    out: list[DrawingPoint] = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Некорректные точки рисунка")  # noqa: TRY004
        t, price = item.get("t"), item.get("price")
        if not isinstance(t, int) or not isinstance(price, (int, float)):
            raise ValueError("Некорректные точки рисунка")  # noqa: TRY004
        if not math.isfinite(price) or price <= 0:
            raise ValueError("Цена рисунка должна быть больше нуля")
        out.append(DrawingPoint(t=t, price=float(price)))
    return tuple(out)


def _tfs_to_json(tfs: tuple[str, ...] | None) -> str | None:
    if tfs is None:
        return None
    return json.dumps(list(tfs), separators=(",", ":"))


def _tfs_from_json(raw: str | None) -> tuple[str, ...] | None:
    if raw is None:
        return None
    data = json.loads(raw)
    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise ValueError("Некорректный список таймфреймов")
    return tuple(data)


def validate(d: Drawing) -> None:
    if d.kind not in KINDS:
        raise ValueError(f"Неизвестный тип рисунка: {d.kind}")
    if len(d.label) > 60:
        raise ValueError("Подпись рисунка — не длиннее 60 символов")
    pts = d.points
    if d.kind in ONE_POINT:
        if len(pts) != 1:
            raise ValueError("Уровень, вертикаль и заметка задаются одной точкой")
    elif d.kind == "channel":
        if len(pts) != 3:
            raise ValueError("Канал задаётся тремя точками: две на линии тренда и одна на параллели")
    elif len(pts) != 2:
        raise ValueError("Тренд, луч, зона, Фибоначчи, стрелка и линейка задаются двумя точками")
    if d.kind == "text" and not d.label.strip():
        raise ValueError("У текстовой заметки должен быть текст")
    for p in pts:
        if not math.isfinite(p.price) or p.price <= 0:
            raise ValueError("Цена рисунка должна быть больше нуля")
        if p.t < 0:
            raise ValueError("Время рисунка не может быть отрицательным")


def drawing_dto(d: Drawing) -> dict[str, Any]:
    return {
        "id": d.id,
        "uid": d.uid,
        "market": d.market,
        "symbol": d.symbol,
        "kind": d.kind,
        "points": [{"t": p.t, "price": p.price} for p in d.points],
        "label": d.label,
        "locked": d.locked,
        "visible_tfs": list(d.visible_tfs) if d.visible_tfs is not None else None,
        "created_at": d.created_at,
        "updated_at": d.updated_at,
    }


def _row_to_drawing(row: tuple) -> Drawing:
    return Drawing(
        market=row[0],
        symbol=row[1],
        kind=row[2],
        points=_points_from_json(row[3]),
        label=row[4],
        locked=bool(row[5]),
        visible_tfs=_tfs_from_json(row[6]),
        id=row[7],
        uid=row[8],
        created_at=row[9],
        updated_at=row[10],
        deleted_at=row[11],
    )


class DrawingStore:
    def __init__(self, conn: Connection) -> None:
        self._conn = conn
        self._lock = conn.lock

    def add(self, d: Drawing) -> Drawing:
        validate(d)
        now = int(time.time())
        d = replace(
            d,
            label=d.label.strip(),
            uid=uuid.uuid4().hex,
            created_at=now,
            updated_at=now,
            deleted_at=None,
        )
        with self._lock, self._conn:
            (n,) = self._conn.execute(
                "SELECT COUNT(*) FROM chart_drawings WHERE market=? AND symbol=? AND deleted_at IS NULL",
                (d.market, d.symbol),
            ).fetchone()
            if n >= MAX_PER_INSTRUMENT:
                raise ValueError(f"Рисунков на инструмент — не больше {MAX_PER_INSTRUMENT}")
            cur = self._conn.execute(
                """INSERT INTO chart_drawings
                   (market, symbol, kind, points, label, locked, visible_tfs, uid, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    d.market,
                    d.symbol,
                    d.kind,
                    _points_to_json(d.points),
                    d.label,
                    1 if d.locked else 0,
                    _tfs_to_json(d.visible_tfs),
                    d.uid,
                    d.created_at,
                    d.updated_at,
                ),
            )
        return replace(d, id=cur.lastrowid)

    def list(self, market: str, symbol: str, deleted: bool = False) -> list[Drawing]:
        cond = "IS NOT NULL" if deleted else "IS NULL"
        with self._lock:
            rows = self._conn.execute(
                f"SELECT {_COLS} FROM chart_drawings WHERE market=? AND symbol=? AND deleted_at {cond} ORDER BY id",
                (market, symbol),
            ).fetchall()
        return [_row_to_drawing(r) for r in rows]

    def update(self, drawing_id: int, *, points: tuple[DrawingPoint, ...] | None = None, label: str | None = None, locked: bool | None = None) -> Drawing:
        with self._lock, self._conn:
            row = self._conn.execute(
                f"SELECT {_COLS} FROM chart_drawings WHERE id=? AND deleted_at IS NULL", (drawing_id,)
            ).fetchone()
            if not row:
                raise ValueError("Рисунок не найден")
            current = _row_to_drawing(row)
            if current.locked and (points is not None or label is not None):
                raise ValueError("Рисунок заблокирован")
            next_pts = points if points is not None else current.points
            next_label = label.strip() if label is not None else current.label
            next_locked = locked if locked is not None else current.locked
            updated = replace(current, points=next_pts, label=next_label, locked=next_locked)
            validate(updated)
            now = int(time.time())
            self._conn.execute(
                """UPDATE chart_drawings SET points=?, label=?, locked=?, updated_at=? WHERE id=?""",
                (_points_to_json(updated.points), updated.label, 1 if updated.locked else 0, now, drawing_id),
            )
        return replace(updated, updated_at=now)

    def remove(self, drawing_id: int) -> bool:
        with self._lock, self._conn:
            return (
                self._conn.execute(
                    "UPDATE chart_drawings SET deleted_at=? WHERE id=? AND deleted_at IS NULL",
                    (int(time.time()), drawing_id),
                ).rowcount
                == 1
            )

    def restore(self, drawing_id: int) -> bool:
        with self._lock, self._conn:
            return (
                self._conn.execute(
                    "UPDATE chart_drawings SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL", (drawing_id,)
                ).rowcount
                == 1
            )
