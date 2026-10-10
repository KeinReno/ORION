"""Маршруты прогнозов-сценариев. Снимок неизменяем: пересчёт создаёт новую запись,
старая остаётся такой, какой была сделана, — задним числом прогнозы не подчищаются.
Проверка надёжности (walk-forward) снимок не создаёт, но дописывает свою запись:
следующий POST /api/forecast копирует последнюю проверку этого ряда и горизонта.
Вероятности в снимке появляются только при вердикте good. Реконструкция прошлого
момента позднюю проверку не подмешивает и в базу не пишется."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from compass.forecast import (
    HORIZON_DEFAULT,
    HORIZON_MAX,
    HORIZON_MIN,
    ForecastSnapshot,
    ForecastStore,
    forecast_at,
    forecast_brief,
    forecast_dto,
    forecast_from_history,
)
from compass.forecast_eval import MAX_POINTS_DEFAULT, walk_forward
from compass.markets.base import MarketError
from compass.models import closed_candles
from compass.strategies import candles_to_df
from compass.validation import data_fingerprint

if TYPE_CHECKING:
    from compass.api.app import Services

FORECAST_MIN_CANDLES = 150  # меньше — модуль всё равно откажет; режем раньше понятной ошибкой


class ForecastRequest(BaseModel):
    market: str
    symbol: str
    tf: str = "1d"
    limit: int = Field(750, ge=FORECAST_MIN_CANDLES, le=20000)  # на 1d, горизонте 12 нужно около 500 свечей
    horizon: int = Field(HORIZON_DEFAULT, ge=HORIZON_MIN, le=HORIZON_MAX)
    stop: float | None = Field(None, gt=0)
    target: float | None = Field(None, gt=0)


class EvaluateRequest(BaseModel):
    market: str
    symbol: str
    tf: str = "1d"
    limit: int = Field(1500, ge=FORECAST_MIN_CANDLES, le=20000)
    horizon: int = Field(HORIZON_DEFAULT, ge=HORIZON_MIN, le=HORIZON_MAX)
    step: int = Field(0, ge=0, le=500)
    max_points: int = Field(MAX_POINTS_DEFAULT, ge=10, le=400)
    until: int | None = None  # индекс последней оцениваемой свечи; None — последняя известная
    seed: int | None = None  # None — seed из отпечатка данных, как у снимка


def _btc_frame(svc: Services, symbol: str, tf: str, limit: int):
    """Контекст BTC для альтов. Сам BTC и не-крипта — без ряда: признак остаётся нулём."""
    base = symbol.split("/")[0].split("-")[0].upper()
    if base in {"BTC", "XBT"}:
        return None
    try:
        res = svc.cache.get("crypto", "BTC/USDT", tf, limit)
    except MarketError:
        return None
    candles = closed_candles(res.candles, tf, svc.now_ms())
    if len(candles) < 30:
        return None
    return candles_to_df(candles)


def register_forecast_routes(app: FastAPI, svc: Services) -> None:
    if svc.forecasts is None:
        return
    store: ForecastStore = svc.forecasts

    @app.post("/api/forecast")
    def create_forecast(req: ForecastRequest) -> dict:
        """Считает распределение исходов похожих прошлых ситуаций и сохраняет снимок."""
        if req.market not in svc.adapters:
            raise HTTPException(404, f"Неизвестный рынок: {req.market}")
        res = svc.cache.get(req.market, req.symbol, req.tf, req.limit)
        candles = closed_candles(res.candles, req.tf, svc.now_ms())
        if len(candles) < FORECAST_MIN_CANDLES:
            raise ValueError(
                f"Слишком мало истории для прогноза (нужно хотя бы {FORECAST_MIN_CANDLES} "
                f"закрытых свечей, получено {len(candles)})"
            )
        df = candles_to_df(candles)
        data_hash = data_fingerprint(df)
        seed = int(data_hash[:8], 16)  # воспроизводимость: тот же ряд — те же траектории
        evaluation = store.latest_evaluation(req.market, req.symbol, req.tf, req.horizon)
        btc = _btc_frame(svc, req.symbol, req.tf, req.limit) if req.market == "crypto" else None
        result = forecast_from_history(
            df, horizon=req.horizon, seed=seed, data_stale=res.stale, evaluation=evaluation,
            btc=btc, stop=req.stop, target=req.target,
        )
        snap = ForecastSnapshot(
            market=req.market,
            symbol=req.symbol,
            tf=req.tf,
            source=res.source,
            last_ts=int(result["last_ts"]),
            base_price=float(result["base_price"]),
            horizon=req.horizon,
            data_hash=data_hash,
            candles=len(candles),
            data_info={"stale": bool(res.stale), "fetched_at": res.fetched_at},
            regime=result["regime"],
            features=result["features"],
            analogues=result["analogues"],
            distribution=result["distribution"],
            scenarios=result["scenarios"],
            calibration=result["calibration"],
            assumptions=result["assumptions"],
            warnings=result["warnings"],
        )
        return forecast_dto(store.add(snap))

    @app.post("/api/forecast/preview")
    def preview_forecast(req: ForecastRequest) -> dict:
        """Тот же расчёт, что у снимка, но без записи. Нужен, чтобы увидеть зону до «Сохранить»."""
        if req.market not in svc.adapters:
            raise HTTPException(404, f"Неизвестный рынок: {req.market}")
        res = svc.cache.get(req.market, req.symbol, req.tf, req.limit)
        candles = closed_candles(res.candles, req.tf, svc.now_ms())
        if len(candles) < FORECAST_MIN_CANDLES:
            raise ValueError(
                f"Слишком мало истории для прогноза (нужно хотя бы {FORECAST_MIN_CANDLES} "
                f"закрытых свечей, получено {len(candles)})"
            )
        df = candles_to_df(candles)
        data_hash = data_fingerprint(df)
        seed = int(data_hash[:8], 16)
        evaluation = store.latest_evaluation(req.market, req.symbol, req.tf, req.horizon)
        btc = _btc_frame(svc, req.symbol, req.tf, req.limit) if req.market == "crypto" else None
        result = forecast_from_history(
            df, horizon=req.horizon, seed=seed, data_stale=res.stale, evaluation=evaluation,
            btc=btc, stop=req.stop, target=req.target,
        )
        result.update({
            "market": req.market,
            "symbol": req.symbol,
            "tf": req.tf,
            "source": res.source,
            "data_hash": data_hash,
            "data_info": {"stale": bool(res.stale), "fetched_at": res.fetched_at},
            "preview": True,
        })
        return result

    @app.post("/api/forecast/evaluate")
    def evaluate_forecast(req: EvaluateRequest) -> dict:
        """Walk-forward проверка надёжности: прогноз в каждой прошлой точке — только по данным
        до неё, оценка — по факту. Снимок не создаёт. Дописывает проверку, чтобы следующий
        снимок этого ряда мог показать вероятности, если вердикт good."""
        if req.market not in svc.adapters:
            raise HTTPException(404, f"Неизвестный рынок: {req.market}")
        res = svc.cache.get(req.market, req.symbol, req.tf, req.limit)
        candles = closed_candles(res.candles, req.tf, svc.now_ms())
        if len(candles) < FORECAST_MIN_CANDLES:
            raise ValueError(
                f"Слишком мало истории для проверки (нужно хотя бы {FORECAST_MIN_CANDLES} "
                f"закрытых свечей, получено {len(candles)})"
            )
        df = candles_to_df(candles)
        data_hash = data_fingerprint(df)
        seed = req.seed if req.seed is not None else int(data_hash[:8], 16)
        btc = _btc_frame(svc, req.symbol, req.tf, req.limit) if req.market == "crypto" else None
        result = walk_forward(
            df, horizon=req.horizon, step=req.step, max_points=req.max_points,
            seed=seed, until=req.until, btc=btc,
        )
        result.update({
            "market": req.market,
            "symbol": req.symbol,
            "tf": req.tf,
            "source": res.source,
            "data_hash": data_hash,
            "data_info": {"stale": bool(res.stale), "fetched_at": res.fetched_at},
        })
        store.add_evaluation(
            market=req.market, symbol=req.symbol, tf=req.tf, horizon=req.horizon,
            data_hash=data_hash, result=result,
        )
        return result

    @app.get("/api/forecasts")
    def list_forecasts(
        market: str | None = None,
        symbol: str | None = None,
        tf: str | None = None,
        limit: int = Query(50, ge=1, le=500),
    ) -> list[dict]:
        """Сохранённые снимки: новейшие сверху. Ничего не пересчитывается."""
        return [forecast_brief(f) for f in store.list(market, symbol, tf, limit)]

    @app.get("/api/forecast/evaluations")
    def list_evaluations(
        market: str,
        symbol: str,
        tf: str | None = None,
        limit: int = Query(20, ge=1, le=100),
    ) -> list[dict]:
        """История проверок надёжности: новейшие сверху. Снимки не пересчитываются."""
        return store.list_evaluations(market, symbol, tf, limit)

    @app.get("/api/forecast/reconstruct")
    def reconstruct_forecast(
        market: str,
        symbol: str,
        at_ts: int = Query(..., description="Момент (мс), на который реконструируется прогноз"),
        tf: str = "1d",
        limit: int = Query(750, ge=FORECAST_MIN_CANDLES, le=20000),
        horizon: int = Query(HORIZON_DEFAULT, ge=HORIZON_MIN, le=HORIZON_MAX),
        seed: int | None = None,  # None — seed из отпечатка видимого окна
    ) -> dict:
        """Reveal Future: прогноз, каким он был на выбранный прошлый момент. Прогнозу видны
        только свечи по at_ts включительно — ни одна свеча правее не читается. Не снимок:
        ничего не сохраняет, поэтому `GET /api/forecasts` его не показывает."""
        if market not in svc.adapters:
            raise HTTPException(404, f"Неизвестный рынок: {market}")
        res = svc.cache.get(market, symbol, tf, limit)
        candles = closed_candles(res.candles, tf, svc.now_ms())
        if len(candles) < FORECAST_MIN_CANDLES:
            raise ValueError(
                f"Слишком мало истории для прогноза (нужно хотя бы {FORECAST_MIN_CANDLES} "
                f"закрытых свечей, получено {len(candles)})"
            )
        df = candles_to_df(candles)
        i = int(df["ts"].searchsorted(at_ts, side="right")) - 1  # последняя свеча, открывшаяся не позже at_ts
        if i < 0:
            raise ValueError("Момент раньше первой свечи: по таким данным прогноз не построить.")
        visible = df.iloc[: i + 1]
        data_hash = data_fingerprint(visible)
        seed_value = seed if seed is not None else int(data_hash[:8], 16)
        btc = _btc_frame(svc, symbol, tf, limit) if market == "crypto" else None
        result = forecast_at(visible, i, horizon=horizon, seed=seed_value, data_stale=res.stale, btc=btc)
        result.update({
            "market": market,
            "symbol": symbol,
            "tf": tf,
            "source": res.source,
            "data_hash": data_hash,
            "data_info": {"stale": bool(res.stale), "fetched_at": res.fetched_at},
            "reconstruction": {
                "method": "causal_walk_forward",
                "at_ts": at_ts,
                "origin_ts": int(result["last_ts"]),
                "bars_visible": i + 1,
                "bars_after": len(df) - (i + 1),
                "note": "Пересчёт по данным до выбранного момента; снимком не сохраняется.",
            },
        })
        return result

    @app.get("/api/forecast/{uid}")
    def get_forecast(uid: str) -> dict:
        f = store.get(uid)
        if f is None:
            raise HTTPException(404, "Прогноз не найден")
        return forecast_dto(f)
