"""Индикаторы на pandas. Все функции чистые: Series на входе — Series на выходе,
первые значения (прогрев) — NaN."""

from __future__ import annotations

import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """RSI по Уайлдеру (сглаживание alpha=1/n)."""
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    out = 100 - 100 / (1 + gain / loss)
    # loss == 0 → rs = inf → 100 - 0 = 100 уже корректно; 0/0 (плоский ряд) → NaN
    return out


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Средний истинный диапазон по Уайлдеру. Нужны колонки high, low, close."""
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Сила тренда по Уайлдеру. Нужны колонки high, low, close. Первые значения — NaN."""
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = up.where((up > down) & (up > 0), 0.0)
    minus_dm = down.where((down > up) & (down > 0), 0.0)
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    smooth = {"alpha": 1 / n, "adjust": False, "min_periods": n}
    atr_w = tr.ewm(**smooth).mean()
    plus_di = 100 * plus_dm.ewm(**smooth).mean() / atr_w.replace(0, pd.NA)
    minus_di = 100 * minus_dm.ewm(**smooth).mean() / atr_w.replace(0, pd.NA)
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, pd.NA) * 100
    return dx.ewm(**smooth).mean()
