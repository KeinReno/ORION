"""Локальный HTTP API. Слушает только 127.0.0.1 — это API одного пользователя на его
машине, не сервис. От чужих веб-страниц защищает api/guard.py."""

from __future__ import annotations

import sys
import time
from collections.abc import AsyncIterator, Callable
from contextlib import aclosing, asynccontextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from compass import __version__, autostart, execution, portfolio
from compass import cockpit as cockpit_mod
from compass import presets as presets_mod
from compass import review_week as review_week_mod
from compass import screener as screener_mod
from compass.accounts import Account, AccountStore
from compass.ai.service import AiService
from compass.alerts import AlertEngine, AlertStore, AlertWatcher
from compass.api.ai_routes import register_ai_routes
from compass.api.backtest_routes import register_backtest_routes
from compass.api.chart_routes import register_chart_routes
from compass.api.crypto_routes import register_crypto_routes
from compass.api.discipline_routes import register_discipline_routes
from compass.api.forecast_routes import register_forecast_routes
from compass.api.guard import install_guard
from compass.api.journal_routes import register_journal_routes
from compass.api.replay_routes import register_replay_routes
from compass.api.sim_routes import register_sim_routes
from compass.api.signal_routes import register_signal_routes
from compass.api.trade_scenario_routes import (
    TradeScenarioDeps,
    TradeScenarioRequest,
    build_trade_scenario,
    register_trade_scenario_routes,
)
from compass.cache import CandleCache
from compass.crypto_tools import (
    basket_note,
    btc_link_note,
    btc_regime,
    coin_profile,
    correlation,
    quote_warning,
)
from compass.data_quality import check_candles
from compass.drawings import DrawingStore
from compass.experiments import ExperimentLog
from compass.forecast import ForecastStore
from compass.journal import Journal
from compass.levels import LevelStore
from compass.live import OkxLive, PollingLive, history_dto, poll_subscription, subscription
from compass.markets.base import MarketAdapter, MarketError
from compass.models import (
    TIMEFRAME_MS,
    Instrument,
    InstrumentInfo,
    closed_candles,
)
from compass.plans import Plan, PlanStore, plan_dto, review
from compass.replay import ReplayStore
from compass.sim_session import SimStore
from compass.risk import WORSE_SLIPPAGE_MULT, position_size
from compass.scheduler import BackgroundScanner
from compass.settings import Settings
from compass.signals import (
    SignalEngine,
    SignalStore,
    _chosen_strategies,
    assess_signal,
)
from compass.strategies import STRATEGIES, candles_to_df, strategy_version
from compass.watchlist import Watchlist

CRYPTO_QTY_STEP = 1e-6


def static_dir() -> Path:
    """В установленной сборке интерфейс лежит рядом с распакованным exe, не в исходниках."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "static"
    return Path(__file__).resolve().parent.parent / "static"


STATIC_DIR = static_dir()


@dataclass
class Services:
    adapters: dict[str, MarketAdapter]
    cache: CandleCache
    watchlist: Watchlist
    settings: Settings
    signals: SignalStore
    engine: SignalEngine
    journal: Journal
    ai: AiService
    scanner: BackgroundScanner | None = None  # None — фонового скана нет (тесты)
    live: OkxLive | None = None
    polling: PollingLive | None = None  # опрос для рынков без WebSocket
    plans: PlanStore | None = None
    experiments: ExperimentLog | None = None
    accounts: AccountStore | None = None
    replay: ReplayStore | None = None
    sim: SimStore | None = None
    levels: LevelStore | None = None
    drawings: DrawingStore | None = None
    alerts: AlertStore | None = None
    alert_engine: AlertEngine | None = None
    # окно приложения (desktop.Shell): есть только в режиме окна, у `python -m compass` — None
    shell: Any | None = None
    alert_watcher: AlertWatcher | None = None  # None — фоновой проверки нет (тесты)
    forecasts: ForecastStore | None = None
    now_ms: Callable[[], int] = lambda: int(time.time() * 1000)


class PlanRequest(BaseModel):
    market: str
    symbol: str
    entry: float
    stop: float
    target: float | None = None
    reason: str
    signal_id: int | None = None
    strategy: str | None = None  # для ручного плана; при signal_id берётся из сигнала
    params: dict[str, int] | None = None
    qty: float | None = None  # явное количество; иначе размер по риску (/api/risk)
    capital: float | None = None
    risk_pct: float | None = None
    available: float | None = None
    fee_pct: float | None = None
    slippage_pct: float | None = None
    spread_pct: float | None = None  # по умолчанию — спред профиля рынка


class AutostartRequest(BaseModel):
    enabled: bool


class WatchItem(BaseModel):
    market: str
    symbol: str
    name: str = ""


class ReconcileRequest(BaseModel):
    market: str
    positions: list[dict] = Field(max_length=500)  # [{symbol, qty, avg_price?}] из выписки брокера


class RiskRequest(BaseModel):
    market: str
    symbol: str
    entry: float
    stop: float
    capital: float | None = None  # по умолчанию — из настроек
    risk_pct: float | None = None
    available: float | None = None  # свободные средства; по умолчанию — весь капитал
    fee_pct: float | None = None  # по умолчанию — типичная комиссия рынка
    slippage_pct: float | None = None
    spread_pct: float | None = None  # по умолчанию — спред профиля рынка


class UiFiles(StaticFiles):
    """Статика интерфейса. Страницу браузер каждый раз сверяет с сервером: иначе после обновления программы
    окно показывает прежний интерфейс из кэша. Файлы в assets/ носят хэш в имени и кэшируются как обычно."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.media_type == "text/html":
            response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(svc: Services, session_token: str | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if svc.scanner:
            svc.scanner.start()
        if svc.alert_watcher:
            svc.alert_watcher.start()
        try:
            yield
        finally:
            if svc.scanner:
                svc.scanner.stop()
            if svc.alert_watcher:
                svc.alert_watcher.stop()

    app = FastAPI(title="Compass", version=__version__, lifespan=lifespan)
    install_guard(app, session_token)

    def adapter(market: str) -> MarketAdapter:
        a = svc.adapters.get(market)
        if a is None:
            raise HTTPException(404, f"Неизвестный рынок: {market}")
        return a

    @app.exception_handler(MarketError)
    def _market_error(_req, exc: MarketError):
        return JSONResponse({"detail": str(exc)}, status_code=502)

    @app.exception_handler(ValueError)
    def _value_error(_req, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "version": __version__}

    # --- рынки, свечи, вотчлист ---

    @app.post("/api/app/show")
    def app_show() -> dict:
        """Повторный запуск ярлыка: показать уже работающее окно вместо второго экземпляра."""
        if svc.shell is None:
            raise HTTPException(404, "Compass запущен без окна")
        svc.shell.show()
        return {"ok": True}

    @app.get("/api/app/autostart")
    def autostart_get() -> dict:
        return autostart.status()

    @app.put("/api/app/autostart")
    def autostart_put(req: AutostartRequest) -> dict:
        """Запуск вместе с Windows: запись в Run текущего пользователя, без прав администратора."""
        if not autostart.supported():
            raise HTTPException(400, autostart.status()["note"])
        autostart.set_enabled(req.enabled)
        return autostart.status()

    @app.get("/api/markets")
    def markets() -> list[dict]:
        return [
            {
                "id": a.id, "name": a.name, "timeframes": list(a.timeframes),
                "source": getattr(a, "source_id", a.id),
                "delay_seconds": 900 if a.id == "moex" else None,
                "live_supported": _live_for(a.id) is not None,
                "live_kind": ("stream" if _live_for(a.id) is svc.live else "poll") if _live_for(a.id) is not None else None,
                "instruments": getattr(a, "catalog_size", lambda: 0)(),
                "profile": execution.profile(a.id).dto(),
            }
            for a in svc.adapters.values()
        ]

    @app.get("/api/markets/{market}/search")
    def search(market: str, q: str = Query(min_length=1)) -> list[dict]:
        return [asdict(i) for i in adapter(market).search(q)]

    @app.get("/api/candles")
    def candles(
        market: str, symbol: str, tf: str = "1d", limit: int = Query(500, ge=1, le=20000)
    ) -> dict:
        adapter(market)
        res = svc.cache.get(market, symbol, tf, limit)
        return {**history_dto(res), "quality": check_candles(res.candles, market, tf)}

    def _live_for(market: str):
        if market == "crypto" and svc.live is not None:
            ex = getattr(svc.adapters.get("crypto"), "exchange_id", "okx")
            if ex == "okx":
                return svc.live
        return svc.polling if svc.polling is not None and svc.polling.supports(market) else None

    @app.get("/api/live")
    async def live_candles(request: Request, symbol: str, tf: str = "1d", market: str = "crypto"):
        feed = _live_for(market)
        if feed is None:
            raise HTTPException(409, "Для этого рынка живое обновление недоступно")
        if feed is svc.live:
            subscription(symbol, tf)
        else:
            poll_subscription(svc.adapters, market, symbol, tf)
        # Локальный endpoint не должен открывать потоки по запросу стороннего сайта.
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            raise HTTPException(403, "Запрос должен идти из Compass")
        if feed.connections >= feed.max_connections:
            raise HTTPException(429, "Слишком много открытых графиков с потоком")

        async def stream():
            feed.connections += 1
            try:
                source = feed.events(symbol, tf) if feed is svc.live else feed.events(market, symbol, tf)
                async with aclosing(source):
                    async for event in source:
                        yield event
            finally:
                feed.connections -= 1

        return StreamingResponse(stream(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
        })

    @app.get("/api/watchlist")
    def watchlist_list() -> list[dict]:
        return [asdict(i) for i in svc.watchlist.list()]

    @app.get("/api/watchlist/sparks")
    def watchlist_sparks(market: str, bars: int = Query(48, ge=8, le=200)) -> dict:
        """Мини-графики избранного: закрытия последних свечей таймфрейма рынка — только из кэша, без запросов к бирже.
        Кэш наполняет сканер; у тикера без загруженного ряда записи нет, и интерфейс мини-график не рисует."""
        adapter(market)
        tf = svc.settings.all().get(f"tf_{market}")
        now = svc.now_ms()
        items: dict[str, dict] = {}
        for inst in svc.watchlist.list():
            if inst.market != market:
                continue
            closed = closed_candles(svc.cache.peek(market, inst.symbol, tf, bars + 1), tf, now)[-bars:]
            if len(closed) < 2:
                continue
            first, last = closed[0].close, closed[-1].close
            items[inst.symbol] = {
                "closes": [c.close for c in closed],
                "last": last,
                "change_pct": round((last / first - 1) * 100, 2) if first else None,
                "from_ts": closed[0].ts,
                "to_ts": closed[-1].ts,
            }
        return {"market": market, "tf": tf, "bars": bars, "items": items}

    @app.post("/api/watchlist", status_code=201)
    def watchlist_add(item: WatchItem) -> dict:
        adapter(item.market)
        svc.watchlist.add(Instrument(item.symbol, item.name or item.symbol, item.market))
        return item.model_dump()

    @app.get("/api/presets")
    def presets_list(market: str) -> list[dict]:
        """Готовые наборы по темам (сектора акций, категории монет); в ответ попадают только тикеры из справочника биржи."""
        adapter(market)
        have = {i.symbol for i in svc.watchlist.list() if i.market == market}
        out = presets_mod.groups(market)
        for g in out:
            for i in g["instruments"]:
                i["watched"] = i["symbol"] in have
        return out

    @app.post("/api/presets/{market}/{group_id}/add")
    def presets_add(market: str, group_id: str) -> dict:
        """Добавляет в избранное все тикеры набора, которых там ещё нет."""
        adapter(market)
        group = presets_mod.find(market, group_id)
        if group is None:
            raise HTTPException(404, "Такого набора нет")
        have = {i.symbol for i in svc.watchlist.list() if i.market == market}
        added = 0
        for i in group["instruments"]:
            if i["symbol"] not in have:
                svc.watchlist.add(Instrument(i["symbol"], i["name"], market, i["kind"]))
                added += 1
        return {"added": added, "already": len(group["instruments"]) - added, "title": group["title"]}

    @app.delete("/api/watchlist/{market}/{symbol:path}", status_code=204)
    def watchlist_remove(market: str, symbol: str) -> None:
        # symbol:path — у крипты тикер содержит слэш (BTC/USDT)
        if not svc.watchlist.remove(market, symbol):
            raise HTTPException(404, "Тикера нет в вотчлисте")

    # --- параметры инструмента ---

    def instrument_info(market: str, symbol: str) -> InstrumentInfo:
        a = adapter(market)
        fn = getattr(a, "instrument_info", None)
        source = getattr(a, "source_id", market)
        if fn is None:
            return InstrumentInfo(symbol, market, source, complete=False)
        try:
            return fn(symbol)
        except MarketError:
            if market == "moex":
                raise  # неизвестный тикер или ISS недоступен без справочника — гадать лот нельзя
            return InstrumentInfo(symbol, market, source, qty_step=CRYPTO_QTY_STEP, complete=False)

    @app.get("/api/instrument")
    def instrument(market: str, symbol: str) -> dict:
        return asdict(instrument_info(market, symbol))

    # --- стратегии и бэктест ---

    compute_backtest = register_backtest_routes(app, svc, adapter=adapter, candles=candles, instrument_info=instrument_info)

    # --- сигналы ---

    signal_ctx, signal_dto, watch_status = register_signal_routes(app, svc)

    # --- риск и настройки ---

    def account_for(market: str) -> Account:
        acc = svc.accounts.get(market) if svc.accounts else None
        if acc is None:
            raise ValueError(f"Для рынка {market} нет счёта")
        return acc

    def correlated_open_positions(market: str, symbol: str, positions: list[dict]) -> dict:
        """Корреляция дневных доходностей кандидата с открытыми позициями (по кэшу свечей; сбой источника — без вывода)."""
        others = [p["symbol"] for p in positions if p["symbol"] != symbol]
        if not others:
            return {"items": [], "note": None}
        try:
            def closes(sym: str) -> dict[int, float]:
                res = svc.cache.get(market, sym, "1d", 150)
                return {c.ts: c.close for c in closed_candles(res.candles, "1d", svc.now_ms())}

            items = portfolio.correlated_positions(closes(symbol), {s: closes(s) for s in others})
            return {"items": items, "note": None}
        except (MarketError, KeyError):
            return {"items": [], "note": "Корреляцию с открытыми позициями проверить не удалось: нет данных."}

    def risk_calc(req: RiskRequest) -> dict:
        info = instrument_info(req.market, req.symbol)
        acc = account_for(req.market)
        capital = req.capital if req.capital is not None else acc.capital
        if capital is None:
            raise ValueError(
                f"Капитал счёта «{acc.name}» не задан: укажите его в настройках счёта ({acc.currency}). "
                "Рубли и USDT не пересчитываются друг в друга."
            )
        risk_pct = req.risk_pct if req.risk_pct is not None else acc.risk_pct
        snap = account_snapshot(acc)
        available = req.available
        if available is None and snap["free"] is not None:
            available = max(0.0, snap["free"])  # свободные средства с учётом открытых позиций и результата
        is_crypto = req.market == "crypto"
        spread_pct = req.spread_pct
        spread = None
        if is_crypto and spread_pct is None:
            book = getattr(adapter(req.market), "order_book_spread", None)
            if book is not None:
                try:
                    spread = book(req.symbol)
                except MarketError:
                    spread = None
                if spread:
                    spread_pct = spread["spread_pct"]
        model = execution.model_for(req.market, req.fee_pct, req.slippage_pct, spread_pct)
        fee = model.fee_pct
        slip = model.effective_slippage_pct  # проскальзывание + половина спреда: как в бэктесте и на учебном счёте
        # Ухудшенный сценарий умножает только проскальзывание. Половина спреда остаётся один раз.
        worse_slip = model.slippage_pct * WORSE_SLIPPAGE_MULT + model.spread_pct / 2
        bond = info.price_unit == "percent_of_face"
        if bond and not info.face_value:
            raise ValueError("Для облигации не получен номинал: посчитать размер позиции нельзя")
        p = position_size(
            capital,
            risk_pct,
            req.entry,
            req.stop,
            lot=info.lot,
            qty_step=(info.qty_step or CRYPTO_QTY_STEP) if is_crypto else None,
            fee_pct=fee,
            slippage_pct=slip,
            worse_slippage_pct=worse_slip,
            available=available,
            unit_value=info.face_value / 100 if bond and info.face_value else 1.0,
            accrued=info.accrued or 0.0,
            min_qty=info.min_qty,
            min_cost=info.min_cost,
        )
        warnings = [w for w in (p.warning,) if w]
        pf = portfolio.assess_new_position(snap, acc, p.risk_amount, p.cost)
        warnings.extend(pf["warnings"])
        corr = correlated_open_positions(req.market, req.symbol, snap["positions"])
        pf["correlated"] = corr["items"]
        pf["correlation_note"] = corr["note"]
        for c in corr["items"]:
            warnings.append(
                f"Доходности {req.symbol} и открытой позиции {c['symbol']} сильно совпадали в прошлом "
                f"(корреляция {c['correlation']:g}): риск двух позиций фактически складывается."
            )
        if not info.complete:
            warnings.append(
                "Параметры инструмента получены не полностью"
                + (f": шаг количества взят {CRYPTO_QTY_STEP:g} по умолчанию" if is_crypto else "")
                + ". Проверьте лот, шаг цены и минимальную заявку у брокера."
            )
        if info.trading_open is False:
            warnings.append("По данным биржи торги по инструменту сейчас не идут: цена может быть вчерашней.")
        if is_crypto:
            warnings.extend(_crypto_warnings(req.symbol, info.currency))
            if spread:
                warnings.append(
                    f"Спред взят из стакана: {spread['spread_pct']:g}% "
                    f"(bid {spread['bid']:g}, ask {spread['ask']:g}), а не общая цифра для всей крипты."
                )
        for label, price in (("входа", req.entry), ("стопа", req.stop)):
            if info.price_step and abs(price / info.price_step - round(price / info.price_step)) > 1e-6:
                warnings.append(f"Цена {label} не кратна шагу цены {info.price_step:g}: биржа её не примет.")
        if bond:
            warnings.append(
                "Облигация: цена в % от номинала; накопленный купонный доход входит в стоимость покупки, "
                "но не в расчёт потери при стопе."
            )
        return {
            **asdict(p),
            "lot_size": info.lot,
            "currency": info.currency,
            "account": {"market": acc.market, "name": acc.name, "currency": acc.currency},
            "capital": capital,
            "risk_pct": risk_pct,
            "portfolio": pf,
            "unit_value": info.face_value / 100 if bond and info.face_value else 1.0,
            "fee_pct": fee,
            "slippage_pct": slip,
            "slippage_input_pct": model.slippage_pct,
            "spread_pct": model.spread_pct,
            "warnings": warnings,
            "assumptions": [
                "Потеря при стопе — расчётный сценарий, а не гарантированный максимум: цена может пройти стоп гэпом.",
                (
                    f"Считается вход и выход по стопу с комиссией {fee:g}% и проскальзыванием {slip:g}% "
                    f"с каждой стороны (проскальзывание {model.slippage_pct:g}% + половина спреда "
                    f"{model.spread_pct:g}%). Ухудшенное исполнение умножает на {WORSE_SLIPPAGE_MULT:g} "
                    "только проскальзывание, половину спреда не умножает. Это не максимальный убыток."
                ),
                *(
                    [(
                        "Комиссия крипты — одна ставка, без тарифа maker/taker и скидки за объём. "
                        "Если биржа списала её в монете, в журнал пишите сумму в валюте котировки."
                    )]
                    if is_crypto else []
                ),
                "Приложение ничего не исполняет и не блокирует: лимит — предупреждение.",
            ],
        }

    def _crypto_warnings(symbol: str, currency: str | None) -> list[str]:
        out: list[str] = []
        q = quote_warning(currency)
        if q:
            out.append(q)
        try:
            daily = closed_candles(svc.cache.get("crypto", symbol, "1d", 500).candles, "1d", svc.now_ms())
        except MarketError:
            return out
        out.extend(coin_profile(daily)["warnings"])
        if symbol.upper().startswith("BTC/"):
            return out
        try:
            btc = closed_candles(svc.cache.get("crypto", "BTC/USDT", "1d", 150).candles, "1d", svc.now_ms())
        except MarketError:
            return out
        regime = btc_regime(btc)
        if regime["regime"] != "unknown":
            out.append(regime["note"])
        corr, overlap = correlation({c.ts: c.close for c in daily}, {c.ts: c.close for c in btc})
        link = btc_link_note(symbol, corr, overlap)
        if link and corr is not None and corr >= 0.7:
            out.append(link)
        return out

    @app.post("/api/risk")
    def risk(req: RiskRequest) -> dict:
        return risk_calc(req)

    # --- счета и панель дня ---

    def accounts_store() -> AccountStore:
        if svc.accounts is None:
            raise HTTPException(503, "Хранилище счетов недоступно")
        return svc.accounts

    @app.get("/api/accounts")
    def accounts_list() -> list[dict]:
        return [asdict(a) for a in accounts_store().list()]

    @app.put("/api/accounts/{market}")
    def accounts_update(market: str, changes: dict) -> dict:
        try:
            return asdict(accounts_store().update(market, changes))
        except KeyError:
            raise HTTPException(404, f"Счёта для рынка {market} нет") from None

    def marks_for(market: str, symbols: list[str]) -> dict[str, portfolio.Mark]:
        """Рыночные цены для оценки позиций: последняя цена из свечей рабочего таймфрейма рынка.
        Источник недоступен и кэша нет — метки не будет, позиция останется оценённой по входу."""
        tf = svc.settings.get(f"tf_{market}")
        max_age = int(max(1800, min(3 * TIMEFRAME_MS[tf] / 1000, 3 * 86_400)))
        out: dict[str, portfolio.Mark] = {}
        for symbol in symbols:
            try:
                res = svc.cache.get(market, symbol, tf, 5)
            except (MarketError, KeyError):
                continue
            if res.candles:
                last = res.candles[-1]
                out[symbol] = portfolio.Mark(last.close, last.ts, res.fetched_at, res.stale, res.source, max_age)
        return out

    def account_snapshot(acc: Account, broker: list[dict] | None = None) -> dict:
        entries = svc.journal.list(market=acc.market, mode="real")
        held = sorted({p["symbol"] for p in portfolio._open_positions(entries)})
        return portfolio.snapshot(acc, entries, svc.now_ms(), marks_for(acc.market, held), broker)

    @app.post("/api/reconcile")
    def reconcile_with_broker(req: ReconcileRequest) -> dict:
        """Сверка журнала с выпиской брокера, введённой вручную. Ничего не сохраняет и не исправляет."""
        acc = accounts_store().get(req.market)
        if acc is None:
            raise HTTPException(404, f"Счёта для рынка {req.market} нет")
        for b in req.positions:
            if not isinstance(b.get("symbol"), str) or isinstance(b.get("qty"), bool) or not isinstance(b.get("qty"), int | float):
                raise ValueError("Каждая позиция выписки: тикер (текст) и количество (число)")  # noqa: TRY004 — намеренно: ValueError даёт ответ 422 через обработчик
        snap = account_snapshot(acc, req.positions)
        return {"market": req.market, **snap["truth"]["reconciliation"],
                "notes": ["Compass ничего не исправляет: выберите, чья запись верна, и поправьте журнал сами."]}

    @app.get("/api/day")
    def day_panel() -> dict:
        """Панель дня по каждому счёту отдельно: без сложения рублей и USDT."""
        snaps = [account_snapshot(a) for a in accounts_store().list()]
        notes = ["Наблюдение и сигналы работают только при запущенном приложении."]
        basket = _btc_basket_note(snaps)
        if basket:
            notes.append(basket)
        return {
            "accounts": snaps,
            "unseen_signals": len(svc.signals.list(500, True)),
            "problem_sources": [x for x in svc.signals.states() if x["status"] in ("stale", "error")],
            "notes": notes,
        }

    @app.get("/api/cockpit")
    def decision_cockpit() -> dict:
        """Единый ответ на вопросы дня: что происходит, позиции, реальный риск, планы, сигналы, правила, данные.
        Всё берётся из тех же источников, что и остальные экраны (Portfolio Truth, планы, сигналы)."""
        accounts = [account_snapshot(a) for a in accounts_store().list()]
        plans = []
        if svc.plans is not None:
            for p in svc.plans.list(None, None, 100):
                rv = review(p, svc.journal.list(p.market, p.symbol, mode=None))
                if rv["status"] != "closed":
                    plans.append({**plan_dto(p), "review": rv})
        ctx = signal_ctx()
        active = [d for d in (signal_dto(s, ctx) for s in svc.signals.list(200)) if d["status"] == "active"]
        problems = [x for x in svc.signals.states() if x["status"] in ("stale", "error")]
        return cockpit_mod.build(
            accounts, plans, active, watch_status(), problems, svc.now_ms(), _forecast_briefs()
        )

    def _forecast_briefs() -> list[dict]:
        """По одному последнему снимку на инструмент. Кокпит не пересчитывает прогноз."""
        if svc.forecasts is None:
            return []
        seen: set[tuple] = set()
        out: list[dict] = []
        for f in svc.forecasts.list(limit=40):
            key = (f.market, f.symbol, f.tf)
            if key in seen:
                continue
            seen.add(key)
            dist = f.distribution if isinstance(f.distribution, dict) else {}
            out.append({
                "market": f.market,
                "symbol": f.symbol,
                "tf": f.tf,
                "calibration": (f.calibration or {}).get("verdict"),
                "shock": bool((f.regime or {}).get("shock")),
                "stale": bool((f.data_info or {}).get("stale")),
                "barriers": dist.get("barriers"),
            })
        return out

    def _btc_basket_note(snaps: list[dict]) -> str | None:
        crypto = next((s for s in snaps if s["market"] == "crypto"), None)
        if crypto is None:
            return None
        symbols = [p["symbol"] for p in crypto["positions"] if not str(p["symbol"]).upper().startswith("BTC/")]
        if len(symbols) < 2 or "crypto" not in svc.adapters:
            return None
        try:
            btc = {c.ts: c.close for c in closed_candles(svc.cache.get("crypto", "BTC/USDT", "1d", 150).candles, "1d", svc.now_ms())}
            corrs = []
            for sym in symbols:
                series = {c.ts: c.close for c in closed_candles(svc.cache.get("crypto", sym, "1d", 150).candles, "1d", svc.now_ms())}
                corr, _n = correlation(series, btc)
                corrs.append(corr)
        except MarketError:
            return None
        return basket_note(corrs, symbols)

    @app.get("/api/review/week")
    def review_week(days: int = Query(7, ge=1, le=31)) -> dict:
        """Недельный разбор по каждому счёту отдельно: только рассчитанные факты по реальным сделкам."""
        now = svc.now_ms()
        out = []
        for acc in accounts_store().list():
            entries = svc.journal.list(market=acc.market, mode="real")
            out.append(review_week_mod.weekly(acc, entries, lambda uid: plan_store().get_by_uid(uid), now, days))
        return {"accounts": out}

    @app.get("/api/screener")
    def screener() -> dict:
        """Факты по избранному на закрытых свечах выбранного таймфрейма рынка. Сбой одного источника не ломает остальные."""
        cfg = svc.settings.all()
        now = svc.now_ms()
        facts = signal_ctx()
        active = {}
        for s in svc.signals.list(500):
            if assess_signal(s, facts)["status"] == "active":
                active.setdefault((s.market, s.symbol), []).append({"strategy": s.strategy, "side": s.side, "id": s.id})
        paused = set(cfg["paused_instruments"])
        rows = []
        for inst in svc.watchlist.list():
            tf = cfg.get(f"tf_{inst.market}")
            base = {"market": inst.market, "symbol": inst.symbol, "name": inst.name, "tf": tf,
                    "paused": f"{inst.market}|{inst.symbol}" in paused, "signals": active.get((inst.market, inst.symbol), [])}
            try:
                res = svc.cache.get(inst.market, inst.symbol, tf, 300)
            except MarketError as e:
                rows.append({**base, "status": "error", "message": str(e)[:200]})
                continue
            closed = closed_candles(res.candles, tf, now)
            if len(closed) < screener_mod.MIN_BARS:
                rows.append({**base, "status": "short", "message": "Слишком мало закрытых свечей"})
                continue
            df = candles_to_df(closed)
            try:
                chosen = _chosen_strategies(cfg, inst.market, inst.symbol)
            except ValueError:
                chosen = []
            state = {strat.id: int(strat.target(df, params).iloc[-1]) for strat, params in chosen}
            levels = [lv.price for lv in (svc.levels.list(inst.market, inst.symbol) if svc.levels else [])]
            rows.append({**base, "status": "stale" if res.stale else "ok",
                         "message": "источник недоступен, показан кэш" if res.stale else "",
                         **screener_mod.screen_row(df, levels, state)})
        return {
            "rows": rows,
            "notes": [
                "Только факты по закрытым свечам; это фильтр внимания, а не рекомендация.",
                "«Правило в рынке» — что показывает стратегия на последней закрытой свече, а не совет входить.",
            ],
        }

    # --- оповещения о цене ---

    register_chart_routes(app, svc, adapter=adapter)

    # --- планы сделок ---

    def plan_store() -> PlanStore:
        if svc.plans is None:
            raise HTTPException(503, "Хранилище планов недоступно")
        return svc.plans

    @app.post("/api/plans", status_code=201)
    def plan_create(req: PlanRequest) -> dict:
        store = plan_store()
        strategy_id, params, version, notes = req.strategy, req.params, None, []
        if req.signal_id is not None:
            sig = svc.signals.get(req.signal_id)
            if sig is None:
                raise HTTPException(404, "Сигнал не найден")
            if (sig.market, sig.symbol) != (req.market, req.symbol):
                raise ValueError("Сигнал относится к другому инструменту")
            strategy_id, params, version = sig.strategy, sig.params, sig.strategy_version
            if params is None:
                notes.append("Параметры сигнала не сохранены (сигнал создан старой версией): версия стратегии неизвестна.")
        if strategy_id is not None:
            strat = STRATEGIES.get(strategy_id)
            if strat is None:
                raise HTTPException(404, f"Неизвестная стратегия: {strategy_id}")
            if params is not None:
                params = strat.resolve(params)
                if req.signal_id is None:  # у сигнала версия зафиксирована в момент его рождения: пересчитывать её нельзя
                    version = strategy_version(strat, params)
        elif params is not None:
            raise ValueError("Параметры без стратегии не имеют смысла")
        if req.qty is not None:
            r = build_trade_scenario(
                TradeScenarioRequest(
                    market=req.market,
                    symbol=req.symbol,
                    entry=req.entry,
                    stop=req.stop,
                    target=req.target,
                    sizing_mode="qty",
                    qty=req.qty,
                    capital=req.capital,
                    risk_pct=req.risk_pct,
                    available=req.available,
                    fee_pct=req.fee_pct,
                    slippage_pct=req.slippage_pct,
                    spread_pct=req.spread_pct,
                ),
                TradeScenarioDeps(instrument_info, account_for, account_snapshot, adapter, CRYPTO_QTY_STEP),
            )
        else:
            r = risk_calc(
                RiskRequest(
                    market=req.market, symbol=req.symbol, entry=req.entry, stop=req.stop, capital=req.capital,
                    risk_pct=req.risk_pct, available=req.available, fee_pct=req.fee_pct, slippage_pct=req.slippage_pct,
                )
            )
        if r["qty"] <= 0:
            raise ValueError(r["warnings"][0] if r["warnings"] else "Покупать нечего: количество нулевое")
        reward_risk = r.get("reward_risk")
        if reward_risk is None and req.target is not None and req.entry > req.stop:
            reward_risk = round((req.target - req.entry) / (req.entry - req.stop), 2)
        plan = store.add(
            Plan(
                market=req.market, symbol=req.symbol, source=getattr(adapter(req.market), "source_id", req.market),
                entry=req.entry, stop=req.stop, target=req.target, qty=r["qty"], lots=r["lots"],
                capital=r["capital"], risk_pct=r.get("risk_pct") or req.risk_pct or account_for(req.market).risk_pct,
                fee_pct=r["fee_pct"], slippage_pct=r["slippage_pct"], cost=r["cost"], risk_amount=r["risk_amount"],
                risk_amount_worse=r["risk_amount_worse"],
                budget=r["budget"] if r.get("budget") is not None else r["risk_amount"],
                strategy=strategy_id,
                strategy_version=version, params=params, signal_id=req.signal_id, available=req.available,
                currency=r["currency"], unit_value=r["unit_value"], reward_risk=reward_risk,
                reason=req.reason.strip(), warnings=(*r["warnings"], *notes),
            )
        )
        return {**plan_dto(plan), "assumptions": r["assumptions"]}

    @app.get("/api/plans")
    def plan_list(market: str | None = None, symbol: str | None = None, limit: int = Query(100, ge=1, le=500)) -> list[dict]:
        return [plan_dto(p) for p in plan_store().list(market, symbol, limit)]

    @app.get("/api/plans-active")
    def plans_active(market: str, symbol: str) -> list[dict]:
        """Планы по тикеру, которые ещё не закрыты (вход не выполнен или позиция открыта): их линии рисуются на графике."""
        entries = svc.journal.list(market, symbol, mode=None)
        out = []
        for p in plan_store().list(market, symbol, 50):
            status = review(p, entries)["status"]
            if status != "closed":
                out.append({**plan_dto(p), "status": status})
        return out

    @app.get("/api/plans/{plan_id}")
    def plan_get(plan_id: int) -> dict:
        p = plan_store().get(plan_id)
        if p is None:
            raise HTTPException(404, "План не найден")
        return plan_dto(p)

    @app.get("/api/plans/{plan_id}/review")
    def plan_review(plan_id: int) -> dict:
        p = plan_store().get(plan_id)
        if p is None:
            raise HTTPException(404, "План не найден")
        return review(p, svc.journal.list(p.market, p.symbol, mode=None))

    @app.get("/api/settings")
    def settings_get() -> dict:
        return svc.settings.all()

    @app.put("/api/settings")
    def settings_put(changes: dict) -> dict:
        updated = svc.settings.update(changes)
        if {"crypto_exchange", "crypto_fallback"} & set(changes):
            _apply_crypto_exchange(updated)
        return updated

    def _apply_crypto_exchange(updated: dict) -> None:
        a = svc.adapters.get("crypto")
        configure = getattr(a, "configure", None)
        if configure is None:
            return
        ex = updated["crypto_exchange"] or getattr(a, "boot_exchange", None) or "okx"
        configure(ex, updated["crypto_fallback"] or None, getattr(a, "proxy", None))

    # --- журнал сделок ---

    register_journal_routes(app, svc, adapter=adapter)

    # --- слой дисциплины и глоссарий ---

    changed_facts, discipline_data, compare_data = register_discipline_routes(app, svc, accounts_store=accounts_store, account_snapshot=account_snapshot, plan_store=plan_store, signal_ctx=signal_ctx, signal_dto=signal_dto, decision_cockpit=decision_cockpit)

    register_ai_routes(app, svc, {
        "backtest": lambda req: compute_backtest(req, record=False),
        "changed": changed_facts, "discipline": discipline_data, "compare": compare_data,
    })
    register_replay_routes(app, svc, instrument_info, adapter, CRYPTO_QTY_STEP)
    register_sim_routes(app, svc, instrument_info, adapter, CRYPTO_QTY_STEP)
    register_crypto_routes(app, svc)
    register_forecast_routes(app, svc)
    register_trade_scenario_routes(
        app,
        svc,
        instrument_info=instrument_info,
        account_for=account_for,
        account_snapshot=account_snapshot,
        adapter=adapter,
        crypto_qty_step=CRYPTO_QTY_STEP,
    )

    # Интерфейс — последним: маршруты /api/* должны матчиться раньше статики.
    if STATIC_DIR.is_dir():
        app.mount("/", UiFiles(directory=STATIC_DIR, html=True), name="ui")

    return app


