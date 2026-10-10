"""Крипто-адаптер поверх ccxt. Только публичные данные — ключи не нужны и не
принимаются. Биржа и прокси задаются в настройках: доступность площадок для
резидентов РФ меняется, поэтому биржа — параметр, а не константа."""

from __future__ import annotations

import time
from typing import Any

import ccxt

from compass.catalog import match_instruments, okx_catalog
from compass.crypto_tools import spread_from_book
from compass.markets.base import CandleBatch, MarketError
from compass.models import TIMEFRAME_MS, Candle, Instrument, InstrumentInfo

CRYPTO_EXCHANGES = ("okx", "bybit", "binance", "kucoin", "gate", "mexc")
DERIVATIVES_EXCHANGES = ("okx", "bybit", "binance", "gate", "mexc")
# KuCoin-перпетив живёт в отдельном классе ccxt.kucoinfutures — в этот срез он не
# подключён, чтобы не подмешивать чужой клиент под именем kucoin.
_SWAP_TYPES = {"bybit": "linear", "binance": "future"}  # остальным — ccxt-дефолт swap
_TIMEFRAMES = ("1m", "5m", "15m", "1h", "4h", "1d")
_PAGE = 500  # безопасный размер страницы для большинства бирж


class CryptoAdapter:
    id = "crypto"
    timeframes = _TIMEFRAMES

    def __init__(
        self,
        exchange_id: str = "okx",
        proxy: str | None = None,
        exchange: Any = None,
        fallback_id: str | None = None,
    ) -> None:
        """`exchange` — готовый объект (для тестов); иначе создаётся по exchange_id."""
        self.boot_exchange = exchange_id
        self.proxy = proxy
        self._injected = exchange is not None
        self._fallback: Any = None
        self.fallback_id: str | None = None
        self._ex: Any = exchange
        self._venues: dict[str, Any] = {}
        self._swap_venues: dict[str, Any] = {}
        self.exchange_id = exchange_id
        self.source_id = f"crypto:{exchange_id}"
        self.name = f"Крипта ({exchange_id})"
        # Готовый объект биржи — в тестах. Справочник OKX только у живого адаптера,
        # иначе поиск теста смешается с полным списком пар.
        self._catalog = list(okx_catalog()) if exchange is None and exchange_id == "okx" else []
        if exchange is None:
            self._ex = self._make(exchange_id)
            if fallback_id and fallback_id != exchange_id:
                self.fallback_id = fallback_id
                self._fallback = self._make(fallback_id)

    def configure(self, exchange_id: str, fallback_id: str | None, proxy: str | None = None) -> None:
        """Смена биржи без перезапуска. В тестах с подставленной биржей ничего не делает."""
        if self._injected:
            return
        if exchange_id not in CRYPTO_EXCHANGES:
            raise MarketError(f"Биржа {exchange_id} не из списка: {', '.join(CRYPTO_EXCHANGES)}")
        if proxy is not None:
            self.proxy = proxy
        self.exchange_id = exchange_id
        self.source_id = f"crypto:{exchange_id}"
        self.name = f"Крипта ({exchange_id})"
        self._ex = self._make(exchange_id)
        self._venues.clear()
        self._swap_venues.clear()
        self._catalog = list(okx_catalog()) if exchange_id == "okx" else []
        fb = fallback_id if fallback_id and fallback_id != exchange_id else None
        if fb and fb not in CRYPTO_EXCHANGES:
            raise MarketError(f"Запасная биржа {fb} не из списка: {', '.join(CRYPTO_EXCHANGES)}")
        self.fallback_id = fb
        self._fallback = self._make(fb) if fb else None

    def _make(self, exchange_id: str) -> Any:
        cls = getattr(ccxt, exchange_id, None)
        if cls is None:
            raise MarketError(f"Неизвестная биржа ccxt: {exchange_id}")
        cfg: dict[str, Any] = {"enableRateLimit": True, "timeout": 15000}
        if exchange_id in ("bybit", "mexc"):
            cfg["options"] = {"defaultType": "spot"}
        if exchange_id == "binance":
            # api.binance.com отвечает 451 на geo-ограниченный IP (VPN/датацентр), а официальное
            # зеркало data-api.binance.vision отдаёт те же публичные данные. Рынки только spot:
            # иначе ccxt тянет фьючерсы с fapi и снова получает 451.
            cfg["urls"] = {"api": {"public": "https://data-api.binance.vision/api/v3"}}
            cfg["options"] = {
                "defaultType": "spot",
                "fetchMarkets": {"types": ["spot"], "loadAllOptions": False},
            }
        if self.proxy:
            cfg["proxies"] = {"http": self.proxy, "https": self.proxy}
        return cls(cfg)

    def _promote_fallback(self) -> None:
        self._ex, self._fallback = self._fallback, self._ex
        self.exchange_id, self.fallback_id = self.fallback_id or self.exchange_id, self.exchange_id
        self.source_id = f"crypto:{self.exchange_id}"
        self.name = f"Крипта ({self.exchange_id})"
        self._catalog = list(okx_catalog()) if self.exchange_id == "okx" else []

    def fetch_candles(
        self, symbol: str, timeframe: str, since_ms: int | None, limit: int
    ) -> list[Candle]:
        if timeframe not in _TIMEFRAMES:
            raise MarketError(f"Таймфрейм {timeframe} не поддерживается для крипты")
        exchange, source = self._ex, self.source_id
        fallback, fallback_id = self._fallback, self.fallback_id
        try:
            return CandleBatch(
                self._fetch(exchange, symbol, timeframe, since_ms, limit),
                source,
                complete=since_ms is None,
            )
        except MarketError as e:
            if fallback is None:
                raise
            # полный последний кусок, а не «с места, где остановилась другая биржа»
            try:
                candles = self._fetch(fallback, symbol, timeframe, None, limit)
            except MarketError:
                raise e  # обе не смогли — показываем причину основной, а не запасной
            if self._fallback is fallback:
                self._promote_fallback()
            return CandleBatch(candles, f"crypto:{fallback_id}", complete=True)

    def _fetch(self, ex: Any, symbol: str, timeframe: str, since_ms: int | None, limit: int) -> list[Candle]:
        tf_ms = TIMEFRAME_MS[timeframe]
        cursor = since_ms if since_ms is not None else int(time.time() * 1000 - tf_ms * limit)
        out: dict[int, Candle] = {}
        try:
            while len(out) < limit:
                rows = ex.fetch_ohlcv(symbol, timeframe, since=cursor, limit=_PAGE)
                if not rows:
                    break
                for ts, o, h, l, c, v in rows:
                    out[int(ts)] = Candle(int(ts), float(o), float(h), float(l), float(c), float(v or 0))
                last = int(rows[-1][0])
                if last + tf_ms <= cursor or len(rows) < 2:
                    break  # биржа не двигает курсор — выходим, а не крутимся вечно
                cursor = last + tf_ms
        except ccxt.BaseError as e:
            raise _unavailable(getattr(ex, "id", "?"), e) from e
        return sorted(out.values(), key=lambda c: c.ts)[-limit:]

    def peer(self, exchange_id: str) -> Any:
        """Клиент второй площадки. Основную биржу и запасную не подменяет."""
        if exchange_id not in CRYPTO_EXCHANGES:
            raise MarketError(f"Биржа {exchange_id} не из списка: {', '.join(CRYPTO_EXCHANGES)}")
        if exchange_id == self.exchange_id:
            return self._ex
        if exchange_id == self.fallback_id and self._fallback is not None:
            return self._fallback
        hit = self._venues.get(exchange_id)
        if hit is not None:
            return hit
        if self._injected:
            raise MarketError(f"Нет подключения к {exchange_id}")
        made = self._make(exchange_id)
        self._venues[exchange_id] = made
        return made

    def swap_peer(self, exchange_id: str) -> Any:
        """Клиент бессрочных фьючерсов биржи. Спотовые клиенты не подменяет."""
        if exchange_id not in DERIVATIVES_EXCHANGES:
            raise MarketError(f"Деривативы {exchange_id} в Compass не подключены")
        hit = self._swap_venues.get(exchange_id)
        if hit is not None:
            return hit
        if self._injected:
            raise MarketError(f"Нет подключения к {exchange_id}")
        made = self._make_swap(exchange_id)
        self._swap_venues[exchange_id] = made
        return made

    def _make_swap(self, exchange_id: str) -> Any:
        cls = getattr(ccxt, exchange_id, None)
        if cls is None:
            raise MarketError(f"Неизвестная биржа ccxt: {exchange_id}")
        cfg: dict[str, Any] = {
            "enableRateLimit": True,
            "timeout": 15000,
            "options": {"defaultType": _SWAP_TYPES.get(exchange_id, "swap")},
        }
        if self.proxy:
            cfg["proxies"] = {"http": self.proxy, "https": self.proxy}
        return cls(cfg)

    def fetch_venue(self, exchange_id: str, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        """Свечи чужой биржи для наложения. Кэш графика и активную площадку не трогает."""
        if timeframe not in _TIMEFRAMES:
            raise MarketError(f"Таймфрейм {timeframe} не поддерживается для крипты")
        return self._fetch(self.peer(exchange_id), symbol, timeframe, None, limit)

    def quote(self, exchange_id: str, symbol: str) -> dict[str, float | None]:
        """Последняя цена и лучшие bid/ask. Пустые поля — биржа их не отдала."""
        try:
            ticker = self.peer(exchange_id).fetch_ticker(symbol)
        except ccxt.BaseError as e:
            raise _unavailable(exchange_id, e) from e
        if not isinstance(ticker, dict):
            raise MarketError(f"Котировка {exchange_id} пустая")
        return {"last": _positive(ticker.get("last")), "bid": _positive(ticker.get("bid")), "ask": _positive(ticker.get("ask"))}

    def order_book(self, exchange_id: str, symbol: str, limit: int = 50) -> dict:
        """Стакан площадки. 50 уровней покрывают полосы ±1%; биржа может отдать меньше."""
        try:
            book = self.peer(exchange_id).fetch_order_book(symbol, limit=limit)
        except ccxt.BaseError as e:
            raise _unavailable(exchange_id, e) from e
        if not isinstance(book, dict):
            raise MarketError(f"Стакан {exchange_id} пустой")
        return book

    def funding_history(self, exchange_id: str, symbol: str, since_ms: int, limit: int = 1000) -> list[tuple[int, float]]:
        """Фактические ставки funding бессрочного контракта с `since_ms`: [(время, ставка)] по возрастанию."""
        try:
            rows = self.swap_peer(exchange_id).fetch_funding_rate_history(swap_symbol(symbol), since=since_ms, limit=limit)
        except (ccxt.BaseError, AttributeError) as e:
            raise _unavailable(exchange_id, e) from e
        out = []
        for r in rows if isinstance(rows, list) else []:
            ts, rate = r.get("timestamp"), _number(r.get("fundingRate"))
            if isinstance(ts, int | float) and rate is not None:
                out.append((int(ts), rate))
        return sorted(out)

    def derivative(self, exchange_id: str, symbol: str) -> dict[str, Any]:
        """Спот и деривативы площадки одним снимком.

        Секции (спот, перпетив, funding, открытый интерес) независимы: чего
        биржа не отдала — None и причина в `field_errors`, а не выдуманное
        число. Все секции пусты — MarketError с первой причиной.
        """
        perp = swap_symbol(symbol)
        out: dict[str, Any] = {
            "spot_last": None,
            "spot_change_24h_pct": None,
            "perp_last": None,
            "perp_change_24h_pct": None,
            "funding_rate": None,
            "funding_next_ms": None,
            "oi_amount": None,
            "oi_value_usd": None,
        }
        errs: dict[str, str] = {}
        try:
            t = self.peer(exchange_id).fetch_ticker(symbol)
            out["spot_last"] = _positive(t.get("last"))
            out["spot_change_24h_pct"] = _number(t.get("percentage"))
        except (ccxt.BaseError, MarketError, AttributeError) as e:
            errs["spot"] = _fail(exchange_id, e)
        try:
            t = self.swap_peer(exchange_id).fetch_ticker(perp)
            out["perp_last"] = _positive(t.get("last"))
            out["perp_change_24h_pct"] = _number(t.get("percentage"))
        except (ccxt.BaseError, MarketError, AttributeError) as e:
            errs["perp"] = _fail(exchange_id, e)
        try:
            fr = self.swap_peer(exchange_id).fetch_funding_rate(perp)
            out["funding_rate"] = _number(fr.get("fundingRate"))
            ts = fr.get("fundingTimestamp")
            out["funding_next_ms"] = int(ts) if isinstance(ts, int | float) else None
        except (ccxt.BaseError, MarketError, AttributeError) as e:
            errs["funding"] = _fail(exchange_id, e)
        try:
            oi = self.swap_peer(exchange_id).fetch_open_interest(perp)
            out["oi_amount"] = _positive(oi.get("openInterestAmount"))
            out["oi_value_usd"] = _positive(oi.get("openInterestValue"))
        except (ccxt.BaseError, MarketError, AttributeError) as e:
            errs["oi"] = _fail(exchange_id, e)
        if all(
            out[k] is None
            for k in ("spot_last", "perp_last", "funding_rate", "oi_amount", "oi_value_usd")
        ):
            raise MarketError(
                errs.get("spot")
                or errs.get("perp")
                or errs.get("funding")
                or errs.get("oi")
                or f"{exchange_id}: нет данных"
            )
        out["field_errors"] = errs
        return out

    def order_book_spread(self, symbol: str) -> dict[str, float] | None:
        """Спред лучшего bid/ask в процентах от середины. Нет стакана — None, не выдуманные 0,05%."""
        book = self._book(symbol)
        return spread_from_book(book) if book else None

    def _book(self, symbol: str) -> dict | None:
        try:
            return self._ex.fetch_order_book(symbol, limit=5)
        except (ccxt.BaseError, AttributeError):
            if self._fallback is None:
                return None
            try:
                book = self._fallback.fetch_order_book(symbol, limit=5)
            except (ccxt.BaseError, AttributeError):
                return None
            self._promote_fallback()
            return book

    def instrument_info(self, symbol: str) -> InstrumentInfo:
        """Шаги и минимумы — из данных биржи (ccxt load_markets), а не из общей константы."""
        try:
            m = self._use("load_markets").get(symbol)
        except ccxt.BaseError as e:
            raise MarketError(f"Биржа недоступна ({self.exchange_id}): {e}") from e
        if not m or not m.get("spot"):
            raise MarketError(f"Спотовой пары {symbol} нет на бирже {self._ex.id}")
        mode = getattr(self._ex, "precisionMode", None)
        prec, limits = m.get("precision") or {}, m.get("limits") or {}
        return InstrumentInfo(
            symbol, self.id, self.source_id,
            qty_step=_step(prec.get("amount"), mode),
            price_step=_step(prec.get("price"), mode),
            currency=m.get("quote"),
            min_qty=_positive((limits.get("amount") or {}).get("min")),
            min_cost=_positive((limits.get("cost") or {}).get("min")),
            trading_open=m.get("active"),
        )

    def catalog_size(self) -> int:
        return len(self._catalog)

    def search(self, query: str) -> list[Instrument]:
        if self._catalog:
            return match_instruments(self._catalog, query, self.id)
        try:
            markets = self._use("load_markets")
        except ccxt.BaseError as e:
            raise MarketError(f"Биржа недоступна ({self.exchange_id}): {e}") from e
        q = query.strip().upper()
        res = [
            Instrument(m["symbol"], m["symbol"], self.id)
            for m in markets.values()
            if m.get("spot") and m.get("active", True) and q in m["symbol"].upper()
        ]
        return sorted(res, key=lambda i: i.symbol)[:20]

    def _use(self, method: str, *args: Any, **kwargs: Any) -> Any:
        fn = getattr(self._ex, method)
        try:
            return fn(*args, **kwargs)
        except ccxt.BaseError as e:
            if self._fallback is None:
                raise
            try:
                result = getattr(self._fallback, method)(*args, **kwargs)
            except ccxt.BaseError:
                raise e
            self._promote_fallback()
            return result


def _unavailable(exchange_id: str, err: BaseException) -> MarketError:
    text = str(err)
    geo = ("block access from your country", "restricted location", "restricted area")
    if any(phrase in text for phrase in geo):
        return MarketError(
            f"{exchange_id.upper()} недоступна из этой страны: биржа отклоняет "
            "текущий выходной IP. Смените сервер VPN или задайте прокси COMPASS_PROXY."
        )
    return MarketError(f"Биржа недоступна ({exchange_id}): {err}")


def price_gap(primary: float | None, other: float | None) -> dict[str, float] | None:
    """Насколько вторая площадка отличается от основной: плюс — вторая дороже."""
    if primary is None or other is None or primary <= 0:
        return None
    delta = other - primary
    return {"abs": delta, "pct": delta / primary * 100}


def swap_symbol(symbol: str) -> str:
    """BTC/USDT → BTC/USDT:USDT. Размеченный символ (с двоеточием) не трогаем."""
    if ":" in symbol:
        return symbol
    parts = symbol.split("/")
    return f"{symbol}:{parts[1]}" if len(parts) == 2 else symbol


def _positive(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) and v > 0 else None


def _number(v: Any) -> float | None:
    """Число может быть отрицательным (funding) — в отличие от _positive."""
    return float(v) if isinstance(v, int | float) else None


def _fail(exchange_id: str, err: BaseException) -> str:
    """Секция деривативов отказала: понятной строкой, страна — отдельным текстом."""
    return str(err) if isinstance(err, MarketError) else str(_unavailable(exchange_id, err))


def _step(v: Any, mode: Any) -> float | None:
    """ccxt отдаёт точность тремя способами; неизвестный способ — лучше None, чем неверный шаг."""
    if not isinstance(v, int | float) or v <= 0:
        return None
    if mode == ccxt.TICK_SIZE:
        return float(v)
    if mode == ccxt.DECIMAL_PLACES:
        return 10.0 ** -int(v)
    return None
