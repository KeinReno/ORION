"""SQLite: один файл в папке данных пользователя, без сервера и миграционных
инструментов. Схема версионируется через PRAGMA user_version."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

SCHEMA_VERSION = 24

_V1 = """
CREATE TABLE candles (
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
  volume REAL NOT NULL,
  PRIMARY KEY (market, symbol, tf, ts)
) WITHOUT ROWID;

CREATE TABLE fetch_log (
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL, fetched_at INTEGER NOT NULL,
  PRIMARY KEY (market, symbol, tf)
);

CREATE TABLE watchlist (
  market TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL,
  PRIMARY KEY (market, symbol)
);
"""


_V2 = """
CREATE TABLE signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
  strategy TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('buy','exit')),
  candle_ts INTEGER NOT NULL,   -- закрытая свеча, на которой сработал сигнал
  price REAL NOT NULL, stop REAL,
  created_at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0,
  -- один и тот же сигнал на одной свече не дублируется, сколько бы раз ни шёл скан
  UNIQUE (market, symbol, tf, strategy, candle_ts, side)
);
CREATE INDEX signals_created ON signals (created_at DESC);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


_V3 = """
CREATE TABLE journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL, symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  qty REAL NOT NULL CHECK (qty > 0), price REAL NOT NULL CHECK (price > 0),
  fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  ts INTEGER NOT NULL,          -- когда сделка совершена, мс UTC
  note TEXT NOT NULL DEFAULT '',
  signal_id INTEGER,            -- из какого сигнала родилась сделка (необязательно)
  created_at INTEGER NOT NULL
);
CREATE INDEX journal_symbol ON journal (market, symbol, ts);
"""


_V4 = """
CREATE TABLE ai_cache (
  key TEXT PRIMARY KEY,         -- sha256(провайдер, модель, задача, запрос): те же данные — тот же ответ
  provider TEXT NOT NULL, model TEXT NOT NULL,
  response TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX ai_cache_created ON ai_cache (created_at DESC);
"""

# Старую криптоисторию нельзя приписать текущей бирже: настройка могла меняться.
# Сохраняем её отдельно; при первом обращении новый источник загрузит свой ряд.
_V5 = """
ALTER TABLE candles RENAME TO candles_v4;
CREATE TABLE candles (
  source TEXT NOT NULL, market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
  ts INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
  close REAL NOT NULL, volume REAL NOT NULL,
  PRIMARY KEY (source, market, symbol, tf, ts)
) WITHOUT ROWID;
INSERT INTO candles
SELECT CASE WHEN market='moex' THEN 'moex:iss' ELSE 'legacy:' || market END,
       market, symbol, tf, ts, open, high, low, close, volume FROM candles_v4;
DROP TABLE candles_v4;
ALTER TABLE fetch_log RENAME TO fetch_log_v4;
CREATE TABLE fetch_log (
  source TEXT NOT NULL, market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source, market, symbol, tf)
);
INSERT INTO fetch_log
SELECT CASE WHEN market='moex' THEN 'moex:iss' ELSE 'legacy:' || market END,
       market, symbol, tf, fetched_at FROM fetch_log_v4;
DROP TABLE fetch_log_v4;
"""

# Причина входа и плановый стоп — чтобы сравнить замысел со сделкой, которую записал пользователь.
_V6 = """
ALTER TABLE journal ADD COLUMN planned_stop REAL;
ALTER TABLE journal ADD COLUMN reason TEXT NOT NULL DEFAULT '';
"""

# Параметры стратегии, породившие сигнал (JSON). У старых сигналов NULL: их параметры не сохранялись,
# и приложение не выдумывает их задним числом.
_V7 = """
ALTER TABLE signals ADD COLUMN params TEXT;
"""

# Режим сделки (реальная/учебная/историческая), стабильный uid для восстановления без дублей и
# мягкое удаление. Старые записи считаются реальными: других раньше не было.
_V8 = """
ALTER TABLE journal ADD COLUMN mode TEXT NOT NULL DEFAULT 'real' CHECK (mode IN ('real','paper','historical'));
ALTER TABLE journal ADD COLUMN uid TEXT;
ALTER TABLE journal ADD COLUMN deleted_at INTEGER;
UPDATE journal SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
CREATE UNIQUE INDEX journal_uid ON journal (uid);
"""

# Неизменяемые планы сделок, версия стратегии в сигнале и связь записи журнала с планом.
# Триггеры не дают изменить или удалить план: разбор план/факт честен, только пока план такой, каким был написан.
_V9 = """
ALTER TABLE signals ADD COLUMN strategy_version TEXT;
ALTER TABLE journal ADD COLUMN plan_uid TEXT;
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  market TEXT NOT NULL, symbol TEXT NOT NULL, source TEXT NOT NULL,
  strategy TEXT, strategy_version TEXT, params TEXT, signal_id INTEGER,
  entry REAL NOT NULL CHECK (entry > 0), stop REAL NOT NULL CHECK (stop > 0 AND stop < entry),
  target REAL CHECK (target IS NULL OR target > entry),
  qty REAL NOT NULL CHECK (qty > 0), lots REAL NOT NULL,
  capital REAL NOT NULL, risk_pct REAL NOT NULL, available REAL,
  fee_pct REAL NOT NULL, slippage_pct REAL NOT NULL,
  cost REAL NOT NULL, risk_amount REAL NOT NULL, risk_amount_worse REAL NOT NULL, budget REAL NOT NULL,
  currency TEXT, unit_value REAL NOT NULL DEFAULT 1, reward_risk REAL,
  reason TEXT NOT NULL, warnings TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX plans_symbol ON plans (market, symbol, id);
CREATE TRIGGER plans_no_update BEFORE UPDATE ON plans BEGIN SELECT RAISE(ABORT, 'План сделки неизменяем'); END;
CREATE TRIGGER plans_no_delete BEFORE DELETE ON plans BEGIN SELECT RAISE(ABORT, 'План сделки нельзя удалить'); END;
"""

# История всех проверок стратегий (запусков и переборов): только добавление, чтобы нельзя было
# оставить одни удачные результаты.
_V10 = """
CREATE TABLE experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('backtest','validate')),
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
  strategy TEXT NOT NULL, strategy_version TEXT, params TEXT NOT NULL, config TEXT NOT NULL,
  data_hash TEXT NOT NULL, engine_version TEXT NOT NULL, candles INTEGER NOT NULL,
  n_variants INTEGER NOT NULL CHECK (n_variants >= 1), result TEXT NOT NULL
);
CREATE INDEX experiments_rule ON experiments (market, symbol, tf, strategy);
CREATE TRIGGER experiments_no_update BEFORE UPDATE ON experiments BEGIN SELECT RAISE(ABORT, 'История проверок неизменяема'); END;
CREATE TRIGGER experiments_no_delete BEFORE DELETE ON experiments BEGIN SELECT RAISE(ABORT, 'Историю проверок нельзя удалить'); END;
"""

# Счета: у каждого рынка свой счёт со своей валютой и лимитами. Рублёвый счёт наследует капитал и риск на сделку
# из прежних настроек (если они были заданы); капитал USDT-счёта НЕ придумывается — рубли в USDT не превращаются.
_V11 = """
CREATE TABLE accounts (
  market TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  capital REAL CHECK (capital IS NULL OR capital > 0),
  risk_pct REAL NOT NULL DEFAULT 1 CHECK (risk_pct > 0 AND risk_pct <= 100),
  daily_loss_limit_pct REAL NOT NULL DEFAULT 3 CHECK (daily_loss_limit_pct > 0 AND daily_loss_limit_pct <= 100),
  max_open_risk_pct REAL NOT NULL DEFAULT 6 CHECK (max_open_risk_pct > 0 AND max_open_risk_pct <= 100)
);
INSERT INTO accounts (market, name, currency, capital, risk_pct)
VALUES (
  'moex', 'Рублёвый брокерский счёт', 'RUB',
  COALESCE((SELECT NULLIF(CAST(value AS REAL), 0) FROM settings WHERE key = 'capital'), 100000.0),
  COALESCE((SELECT NULLIF(CAST(value AS REAL), 0) FROM settings WHERE key = 'risk_pct'), 1.0)
);
INSERT INTO accounts (market, name, currency, capital, risk_pct)
VALUES (
  'crypto', 'Криптосчёт (USDT)', 'USDT', NULL,
  COALESCE((SELECT NULLIF(CAST(value AS REAL), 0) FROM settings WHERE key = 'risk_pct'), 1.0)
);
"""

# Сигналы: когда уведомили (NULL — ещё нет, например из-за тихих часов) и когда пользователь их отклонил.
# scan_state: чем закончилась последняя проверка каждого инструмента — из этого видно, какие источники подводят.
_V12 = """
ALTER TABLE signals ADD COLUMN notified_at INTEGER;
ALTER TABLE signals ADD COLUMN dismissed_at INTEGER;
UPDATE signals SET notified_at = created_at;
CREATE TABLE scan_state (
  market TEXT NOT NULL, symbol TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','stale','error','short','paused')),
  message TEXT NOT NULL DEFAULT '',
  last_scan_at INTEGER NOT NULL, last_ok_at INTEGER,
  PRIMARY KEY (market, symbol)
);
"""

# Учебные сессии воспроизведения свечей. Свечи заморожены копией в сессии; сделки — свои, в журнал реальных не попадают.
_V13 = """
CREATE TABLE replay_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL, source TEXT NOT NULL,
  capital REAL NOT NULL CHECK (capital > 0),
  fee_pct REAL NOT NULL CHECK (fee_pct >= 0), slippage_pct REAL NOT NULL CHECK (slippage_pct >= 0),
  start_index INTEGER NOT NULL, cursor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','finished')),
  data_hash TEXT NOT NULL,
  pending TEXT, stop REAL,
  candles TEXT NOT NULL
);
CREATE TABLE replay_fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES replay_sessions(id),
  ts INTEGER NOT NULL, side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  qty REAL NOT NULL CHECK (qty > 0), price REAL NOT NULL CHECK (price > 0), fee REAL NOT NULL CHECK (fee >= 0),
  reason TEXT NOT NULL, stop REAL
);
CREATE INDEX replay_fills_session ON replay_fills (session_id, id);
CREATE TRIGGER replay_fills_no_update BEFORE UPDATE ON replay_fills BEGIN SELECT RAISE(ABORT, 'Сделка учебной сессии неизменяема'); END;
CREATE TRIGGER replay_fills_no_delete BEFORE DELETE ON replay_fills BEGIN SELECT RAISE(ABORT, 'Сделку учебной сессии нельзя удалить'); END;
"""

# Сохранённые уровни пользователя (мягкое удаление) и необязательный лимит числа сделок в день по счёту:
# для внутридневной торговли главный враг — избыточная частота сделок, а не отдельная сделка.
_V14 = """
CREATE TABLE levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL, symbol TEXT NOT NULL,
  price REAL NOT NULL CHECK (price > 0),
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX levels_symbol ON levels (market, symbol);
ALTER TABLE accounts ADD COLUMN max_trades_per_day INTEGER CHECK (max_trades_per_day IS NULL OR max_trades_per_day > 0);
"""

# Оповещения о цене: «сообщи, когда цена дойдёт до X». Срабатывание фиксируется один раз и не стирается.
_V15 = """
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL, symbol TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('above','below')),
  price REAL NOT NULL CHECK (price > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','triggered','cancelled')),
  triggered_at INTEGER, triggered_price REAL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX alerts_status ON alerts (status, market, symbol);
"""

# Биржа, с которой снято закрытие сигнала. У старых сигналов NULL: задним числом источник не выдумываем.
_V16 = """
ALTER TABLE signals ADD COLUMN source TEXT;
"""

# Состояние стратегии (что она хочет сейчас) и ссылка выхода на вход, который он закрывает.
# Состояние пишется сканом; старые базы заполняются со следующей проверки, а не задним числом.
_V17 = """
ALTER TABLE signals ADD COLUMN entry_signal_id INTEGER;
CREATE TABLE strategy_state (
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL, strategy TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target IN (0, 1)),
  since_ts INTEGER NOT NULL,   -- свеча, с которой держится текущая цель
  last_ts INTEGER NOT NULL,    -- последняя закрытая свеча, которую скан уже учёл
  price REAL NOT NULL, stop REAL,
  params TEXT, strategy_version TEXT, source TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (market, symbol, tf, strategy)
);
"""

# Снимок прогноза — неизменяемый: пересчёт создаёт новую запись, старая остаётся такой,
# какой была сделана. Без этого проверять прогнозы задним числом было бы нечестно.
_V18 = """
CREATE TABLE forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL, source TEXT NOT NULL,
  last_ts INTEGER NOT NULL, base_price REAL NOT NULL CHECK (base_price > 0),
  horizon INTEGER NOT NULL CHECK (horizon >= 1),
  model TEXT NOT NULL, model_version TEXT NOT NULL, feature_version TEXT NOT NULL,
  data_hash TEXT NOT NULL, candles INTEGER NOT NULL CHECK (candles >= 1),
  data_info TEXT NOT NULL, regime TEXT NOT NULL, features TEXT NOT NULL,
  analogues TEXT NOT NULL, distribution TEXT NOT NULL, scenarios TEXT NOT NULL,
  calibration TEXT NOT NULL, assumptions TEXT NOT NULL, warnings TEXT NOT NULL
);
CREATE INDEX forecasts_symbol ON forecasts (market, symbol, tf, id);
CREATE TRIGGER forecasts_no_update BEFORE UPDATE ON forecasts BEGIN
  SELECT RAISE(ABORT, 'Прогноз-снимок неизменяем: пересчёт создаёт новый снимок');
END;
CREATE TRIGGER forecasts_no_delete BEFORE DELETE ON forecasts BEGIN
  SELECT RAISE(ABORT, 'Прогноз-снимок нельзя удалить: история прогнозов сохраняется');
END;
"""

# Проверка надёжности прогноза — отдельная история, не снимок. Новая проверка дописывает строку,
# старые не переписываются. Снимок при создании копирует последнюю подходящую проверку.
_V19 = """
CREATE TABLE forecast_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
  horizon INTEGER NOT NULL CHECK (horizon >= 1),
  model TEXT NOT NULL, model_version TEXT NOT NULL, feature_version TEXT NOT NULL,
  data_hash TEXT NOT NULL,
  verdict TEXT NOT NULL,
  verdict_reason TEXT NOT NULL,
  skill_pct REAL, brier REAL, coverage_90 REAL,
  points_scored INTEGER NOT NULL CHECK (points_scored >= 0)
);
CREATE INDEX forecast_evaluations_key
  ON forecast_evaluations (market, symbol, tf, horizon, model, model_version, feature_version, id);
"""

# Рисунки пользователя на графике: координаты время+цена, мягкое удаление.
_V20 = """
CREATE TABLE chart_drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hline','trend','rect','ruler')),
  points TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  locked INTEGER NOT NULL DEFAULT 0,
  visible_tfs TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX chart_drawings_symbol ON chart_drawings (market, symbol);
"""

# Новые рисунки (вертикаль, луч, Фибоначчи, стрелка, текст): допустимые типы проверяет код, а не CHECK таблицы.
_V21 = """
CREATE TABLE chart_drawings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  points TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  locked INTEGER NOT NULL DEFAULT 0,
  visible_tfs TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO chart_drawings_new SELECT id, uid, market, symbol, kind, points, label, locked, visible_tfs, created_at, updated_at, deleted_at FROM chart_drawings;
DROP TABLE chart_drawings;
ALTER TABLE chart_drawings_new RENAME TO chart_drawings;
CREATE INDEX chart_drawings_symbol ON chart_drawings (market, symbol);
"""

# Направление и стоп риска потери. У старых строк поля пустые.
# fill_at = next_open — цена сигнала МосБиржи это открытие следующей свечи.
_V22 = """
ALTER TABLE signals ADD COLUMN target REAL;
ALTER TABLE signals ADD COLUMN leverage REAL;
ALTER TABLE signals ADD COLUMN stake REAL;
ALTER TABLE signals ADD COLUMN fill_at TEXT;
ALTER TABLE signals ADD COLUMN open_px REAL;
ALTER TABLE signals ADD COLUMN direction TEXT;
"""

# Необязательная дневная цель счёта (профит-лок): достигнув её, план говорит закрыть день.
_V23 = """
ALTER TABLE accounts ADD COLUMN daily_profit_target_pct REAL
  CHECK (daily_profit_target_pct IS NULL OR (daily_profit_target_pct > 0 AND daily_profit_target_pct <= 1000));
"""

# Симуляция фьючерсов: сессии на замороженных свечах и неизменяемый журнал событий (заявки, сделки, ликвидации,
# фандинг). Состояние счёта лежит снимком в сессии; в журнал реальных сделок и статистику счетов не попадает.
_V24 = """
CREATE TABLE sim_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  owner TEXT NOT NULL DEFAULT 'user',
  market TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL, source TEXT NOT NULL,
  start_index INTEGER NOT NULL, cursor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','finished')),
  data_hash TEXT NOT NULL,
  funding_source TEXT NOT NULL CHECK (funding_source IN ('history','estimate')),
  candles TEXT NOT NULL, funding TEXT NOT NULL, state TEXT NOT NULL, curve TEXT NOT NULL
);
CREATE TABLE sim_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sim_sessions(id),
  ts INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX sim_log_session ON sim_log (session_id, id);
CREATE TRIGGER sim_log_no_update BEFORE UPDATE ON sim_log BEGIN SELECT RAISE(ABORT, 'Запись журнала симуляции неизменяема'); END;
CREATE TRIGGER sim_log_no_delete BEFORE DELETE ON sim_log BEGIN SELECT RAISE(ABORT, 'Запись журнала симуляции нельзя удалить'); END;
"""


class Connection(sqlite3.Connection):
    """Все сервисы делят блокировку соединения, включая чтение и commit/rollback.

    Держать lock нужно на протяжении всей операции с БД, а не отдельного execute.
    Сетевые вызовы выполняются за пределами блокировки.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.lock = threading.RLock()


def connect(path: Path | str) -> Connection:
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # FastAPI и сканер работают в разных потоках; сервисы используют conn.lock.
    conn = sqlite3.connect(str(path), check_same_thread=False, factory=Connection)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if 0 < version < SCHEMA_VERSION and str(path) != ":memory:":
            backup = Path(str(path) + f".v{version}.bak")
            if not backup.exists():
                saved = sqlite3.connect(str(backup))
                try:
                    conn.backup(saved)
                finally:
                    saved.close()
        _migrate(conn)
    except Exception:
        conn.close()
        raise
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        raise RuntimeError(
            f"База создана более новой версией Compass (схема {version}, "
            f"эта версия знает {SCHEMA_VERSION}). Обновите приложение."
        )
    if version < 1:
        conn.executescript(_V1)
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
    if version < 2:
        conn.executescript(_V2)
        conn.execute("PRAGMA user_version = 2")
        conn.commit()
    if version < 3:
        conn.executescript(_V3)
        conn.execute("PRAGMA user_version = 3")
        conn.commit()
    if version < 4:
        conn.executescript(_V4)
        conn.execute("PRAGMA user_version = 4")
        conn.commit()
    if version < 5:
        conn.executescript("BEGIN IMMEDIATE;\n" + _V5 + "\nPRAGMA user_version = 5;\nCOMMIT;")
    if version < 6:
        conn.executescript(_V6)
        conn.execute("PRAGMA user_version = 6")
        conn.commit()
    if version < 7:
        conn.executescript(_V7)
        conn.execute("PRAGMA user_version = 7")
        conn.commit()
    if version < 8:
        conn.executescript(_V8)
        conn.execute("PRAGMA user_version = 8")
        conn.commit()
    if version < 9:
        conn.executescript(_V9)
        conn.execute("PRAGMA user_version = 9")
        conn.commit()
    if version < 10:
        conn.executescript(_V10)
        conn.execute("PRAGMA user_version = 10")
        conn.commit()
    if version < 11:
        conn.executescript(_V11)
        conn.execute("PRAGMA user_version = 11")
        conn.commit()
    if version < 12:
        conn.executescript(_V12)
        conn.execute("PRAGMA user_version = 12")
        conn.commit()
    if version < 13:
        conn.executescript(_V13)
        conn.execute("PRAGMA user_version = 13")
        conn.commit()
    if version < 14:
        conn.executescript(_V14)
        conn.execute("PRAGMA user_version = 14")
        conn.commit()
    if version < 15:
        conn.executescript(_V15)
        conn.execute("PRAGMA user_version = 15")
        conn.commit()
    if version < 16:
        conn.executescript(_V16)
        conn.execute("PRAGMA user_version = 16")
        conn.commit()
    if version < 17:
        conn.executescript(_V17)
        conn.execute("PRAGMA user_version = 17")
        conn.commit()
    if version < 18:
        conn.executescript(_V18)
        conn.execute("PRAGMA user_version = 18")
        conn.commit()
    if version < 19:
        conn.executescript(_V19)
        conn.execute("PRAGMA user_version = 19")
        conn.commit()
    if version < 20:
        conn.executescript(_V20)
        conn.execute("PRAGMA user_version = 20")
        conn.commit()
    if version < 21:
        conn.executescript(_V21)
        conn.execute("PRAGMA user_version = 21")
        conn.commit()
    if version < 22:
        conn.executescript(_V22)
        conn.execute("PRAGMA user_version = 22")
        conn.commit()
    if version < 23:
        conn.executescript(_V23)
        conn.execute("PRAGMA user_version = 23")
        conn.commit()
    if version < 24:
        conn.executescript(_V24)
        conn.execute("PRAGMA user_version = 24")
        conn.commit()
