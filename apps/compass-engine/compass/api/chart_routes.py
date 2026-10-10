"""То, что пользователь оставляет на графике: оповещения о цене, сохранённые уровни, рисунки."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from typing import TYPE_CHECKING, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from compass.alerts import Alert, AlertStore
from compass.drawings import Drawing, DrawingPoint, DrawingStore, drawing_dto
from compass.levels import Level, LevelStore
from compass.markets.base import MarketAdapter, MarketError

if TYPE_CHECKING:
    from compass.api.app import Services


class AlertRequest(BaseModel):
    market: str
    symbol: str
    price: float = Field(gt=0)
    kind: Literal["above", "below"] | None = None  # по умолчанию — по положению цены относительно текущей
    note: str = Field("", max_length=80)


class DrawingPointRequest(BaseModel):
    t: int = Field(ge=0)
    price: float = Field(gt=0)


class DrawingRequest(BaseModel):
    market: str
    symbol: str
    kind: Literal["hline", "trend", "rect", "ruler", "vline", "ray", "fib", "arrow", "text", "channel"]
    points: list[DrawingPointRequest] = Field(min_length=1, max_length=3)
    label: str = Field("", max_length=60)
    locked: bool = False
    visible_tfs: list[str] | None = None


class DrawingUpdateRequest(BaseModel):
    points: list[DrawingPointRequest] | None = None
    label: str | None = Field(None, max_length=60)
    locked: bool | None = None


class LevelRequest(BaseModel):
    market: str
    symbol: str
    price: float = Field(gt=0)
    label: str = Field("", max_length=60)


def register_chart_routes(
    app: FastAPI,
    svc: Services,
    *,
    adapter: Callable[[str], MarketAdapter],
) -> None:
    def alert_store() -> AlertStore:
        if svc.alerts is None:
            raise HTTPException(503, "Хранилище оповещений недоступно")
        return svc.alerts

    def alert_dto(a: Alert) -> dict:
        return asdict(a)

    @app.post("/api/alerts", status_code=201)
    def alerts_add(req: AlertRequest) -> dict:
        """«Сообщи, когда цена дойдёт до X». Направление выводится из текущей цены, если не задано."""
        adapter(req.market)
        try:
            last = svc.cache.get(req.market, req.symbol, "1h", 2).candles[-1].close
        except (MarketError, IndexError):
            raise ValueError("Не удалось получить текущую цену: оповещение без неё поставить нельзя") from None
        kind = req.kind or ("above" if req.price > last else "below")
        if kind == "above" and req.price <= last:
            raise ValueError(f"Цена уже выше {req.price:g} (сейчас {last:g}): оповещение «выше» сработало бы сразу")
        if kind == "below" and req.price >= last:
            raise ValueError(f"Цена уже ниже {req.price:g} (сейчас {last:g}): оповещение «ниже» сработало бы сразу")
        a = alert_store().add(Alert(req.market, req.symbol, kind, req.price, req.note))
        return {**alert_dto(a), "last_price": last}

    @app.get("/api/alerts")
    def alerts_list(status: str | None = None, market: str | None = None, symbol: str | None = None,
                    unseen: bool = False) -> list[dict]:
        if status is not None and status not in ("active", "triggered", "cancelled"):
            raise ValueError("Статус: active, triggered или cancelled")
        rows = alert_store().list(status, market, symbol)
        return [alert_dto(a) for a in rows if not unseen or not a.seen]

    @app.post("/api/alerts/seen")
    def alerts_seen() -> dict:
        return {"marked": alert_store().mark_seen()}

    @app.post("/api/alerts/check")
    def alerts_check() -> dict:
        """Проверить прямо сейчас (фон делает это раз в минуту)."""
        if svc.alert_engine is None:
            raise HTTPException(503, "Проверка оповещений недоступна")
        return {"triggered": [alert_dto(a) for a in svc.alert_engine.check()]}

    @app.delete("/api/alerts/{alert_id}", status_code=204)
    def alerts_cancel(alert_id: int) -> None:
        if not alert_store().cancel(alert_id):
            raise HTTPException(404, "Активного оповещения с таким номером нет")

    # --- сохранённые уровни ---

    def level_store() -> LevelStore:
        if svc.levels is None:
            raise HTTPException(503, "Хранилище уровней недоступно")
        return svc.levels

    @app.get("/api/levels")
    def levels_list(market: str, symbol: str, deleted: bool = False) -> list[dict]:
        return [asdict(x) for x in level_store().list(market, symbol, deleted)]

    @app.post("/api/levels", status_code=201)
    def levels_add(req: LevelRequest) -> dict:
        adapter(req.market)
        return asdict(level_store().add(Level(req.market, req.symbol, req.price, req.label)))

    @app.delete("/api/levels/{level_id}", status_code=204)
    def levels_remove(level_id: int) -> None:
        if not level_store().remove(level_id):
            raise HTTPException(404, "Уровня нет")

    @app.post("/api/levels/{level_id}/restore")
    def levels_restore(level_id: int) -> dict:
        if not level_store().restore(level_id):
            raise HTTPException(404, "Удалённого уровня с таким номером нет")
        return {"restored": level_id}

    # --- рисунки на графике ---

    def drawing_store() -> DrawingStore:
        if svc.drawings is None:
            raise HTTPException(503, "Хранилище рисунков недоступно")
        return svc.drawings

    def _drawing_from_req(req: DrawingRequest) -> Drawing:
        pts = tuple(DrawingPoint(t=p.t, price=p.price) for p in req.points)
        tfs = tuple(req.visible_tfs) if req.visible_tfs is not None else None
        return Drawing(req.market, req.symbol, req.kind, pts, req.label, req.locked, tfs)

    @app.get("/api/drawings")
    def drawings_list(market: str, symbol: str, deleted: bool = False) -> list[dict]:
        return [drawing_dto(x) for x in drawing_store().list(market, symbol, deleted)]

    @app.post("/api/drawings", status_code=201)
    def drawings_add(req: DrawingRequest) -> dict:
        adapter(req.market)
        try:
            return drawing_dto(drawing_store().add(_drawing_from_req(req)))
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.put("/api/drawings/{drawing_id}")
    def drawings_update(drawing_id: int, req: DrawingUpdateRequest) -> dict:
        pts = tuple(DrawingPoint(t=p.t, price=p.price) for p in req.points) if req.points is not None else None
        try:
            return drawing_dto(drawing_store().update(drawing_id, points=pts, label=req.label, locked=req.locked))
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.delete("/api/drawings/{drawing_id}", status_code=204)
    def drawings_remove(drawing_id: int) -> None:
        if not drawing_store().remove(drawing_id):
            raise HTTPException(404, "Рисунка нет")

    @app.post("/api/drawings/{drawing_id}/restore")
    def drawings_restore(drawing_id: int) -> dict:
        if not drawing_store().restore(drawing_id):
            raise HTTPException(404, "Удалённого рисунка с таким номером нет")
        return {"restored": drawing_id}
