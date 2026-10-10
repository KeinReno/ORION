"""Контракт адаптера рынка. Всё рыночно-специфичное (сессии, лоты, коды
таймфреймов, формат времени) живёт внутри адаптера; ядро видит только Candle."""

from __future__ import annotations

from typing import Protocol

from compass.models import Candle, Instrument


class MarketError(RuntimeError):
    """Источник данных недоступен или вернул неожиданный ответ."""


class CandleBatch(list[Candle]):
    """Свечи с источником именно этого запроса, независимо от следующих переключений.

    `complete=False` — ряд обрезан курсором `since` той биржи, которая ответила.
    Такой ряд нельзя дописывать в кэш другой площадки.
    """

    def __init__(self, candles: list[Candle], source: str, *, complete: bool = True) -> None:
        super().__init__(candles)
        self.source = source
        self.complete = complete


class MarketAdapter(Protocol):
    id: str
    name: str
    timeframes: tuple[str, ...]

    def fetch_candles(
        self, symbol: str, timeframe: str, since_ms: int | None, limit: int
    ) -> list[Candle]:
        """Свечи по возрастанию времени, начиная с since_ms (или последние limit)."""
        ...

    def search(self, query: str) -> list[Instrument]: ...
