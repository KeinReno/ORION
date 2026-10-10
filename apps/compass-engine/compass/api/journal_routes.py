"""Журнал сделок: записи, позиции, выгрузка, резервная копия, восстановление."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from typing import TYPE_CHECKING

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from compass.journal import MODES, Entry
from compass.markets.base import MarketAdapter

if TYPE_CHECKING:
    from compass.api.app import Services


class JournalRequest(BaseModel):
    market: str
    symbol: str
    side: str
    qty: float
    price: float
    ts: int  # мс UTC
    fee: float = 0.0
    note: str = ""
    signal_id: int | None = None
    planned_stop: float | None = None
    reason: str = ""
    mode: str = "real"  # real | paper | historical
    plan_uid: str | None = None  # план, по которому совершена сделка


def register_journal_routes(
    app: FastAPI,
    svc: Services,
    *,
    adapter: Callable[[str], MarketAdapter],
) -> None:
    @app.get("/api/journal.csv")
    def journal_csv() -> Response:
        return Response(
            content=svc.journal.to_csv(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="compass-journal.csv"'},
        )

    @app.get("/api/journal/backup.json")
    def journal_backup() -> Response:
        return JSONResponse(
            svc.journal.backup(svc.plans),
            headers={"Content-Disposition": 'attachment; filename="compass-journal-backup.json"'},
        )

    @app.post("/api/journal/restore")
    def journal_restore(payload: dict) -> dict:
        return svc.journal.restore_backup(payload, svc.plans)

    @app.get("/api/journal/deleted")
    def journal_deleted() -> list[dict]:
        return [asdict(e) for e in svc.journal.deleted()]

    @app.post("/api/journal/{entry_id}/restore")
    def journal_undelete(entry_id: int) -> dict:
        if not svc.journal.restore(entry_id):
            raise HTTPException(404, "Удалённой записи с таким номером нет")
        return {"restored": entry_id}

    def _mode(mode: str) -> str | None:
        if mode == "all":
            return None
        if mode not in MODES:
            raise ValueError("Режим — real, paper, historical или all")
        return mode

    @app.get("/api/journal")
    def journal_list(market: str | None = None, symbol: str | None = None, mode: str = "real") -> list[dict]:
        return [asdict(e) for e in svc.journal.list(market, symbol, _mode(mode))]

    @app.get("/api/journal/positions")
    def journal_positions(mode: str = "real") -> list[dict]:
        return [asdict(p) for p in svc.journal.positions(_mode(mode))]

    @app.post("/api/journal", status_code=201)
    def journal_add(req: JournalRequest) -> dict:
        adapter(req.market)
        return asdict(svc.journal.add(Entry(**req.model_dump())))

    @app.delete("/api/journal/{entry_id}", status_code=204)
    def journal_remove(entry_id: int) -> None:
        if not svc.journal.remove(entry_id):
            raise HTTPException(404, "Записи нет в журнале")
