//! Единая точка правды для операционных таймаутов запуска и остановки ORION-R.
//!
//! Значения здесь — продуктовые решения, а не детали реализации: если таймаут
//! влияет на длительность запуска, менять его только вместе с записью в
//! протоколе бенчмарков (docs/BENCHMARK_PROTOCOL.md). Раньше эти числа были
//! размазаны по шести файлам; правка в одном месте забывала остальные.

use std::time::Duration;

// --- Шелл (apps/desktop/src-tauri): ожидание готовности и завершения ---

/// Дедлайн готовности: сколько шелл ждёт phase=ready от локального runtime.
pub const SHELL_READY_DEADLINE: Duration = Duration::from_secs(360);

/// Интервал опроса startup-state.json и health-пробы шеллом.
pub const SHELL_READY_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Таймаут TCP-подключения одной health-пробы шелла.
pub const SHELL_HEALTH_CONNECT_TIMEOUT: Duration = Duration::from_millis(500);

/// Таймаут чтения ответа одной health-пробы шелла.
pub const SHELL_HEALTH_READ_TIMEOUT: Duration = Duration::from_secs(1);

/// Дедлайн ожидания завершения runtime после сигнала штатной остановки.
pub const SHELL_EXIT_DEADLINE: Duration = Duration::from_secs(540);

/// Интервал опроса завершения runtime шеллом.
pub const SHELL_EXIT_POLL_INTERVAL: Duration = Duration::from_secs(2);

// --- Rust-супервизор API: trial-гейт и откат ---

/// Сколько пробный (trial) payload может не проходить health, прежде чем
/// супервизор откатит его на прежнюю проверенную версию.
pub const TRIAL_TIMEOUT: Duration = Duration::from_secs(150);

/// Интервал опроса API супервизором (готовность, коды выхода, рестарт).
pub const API_POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Таймаут одной health-пробы супервизора к API.
pub const API_HEALTH_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

// --- Дочерние процессы (pg_ctl, prisma, node) ---

/// Чанк ожидания завершения дочернего процесса; ожидание суммируется
/// вызывающей стороной (например, run_to_exit делает 20 чанков).
pub const CHILD_EXIT_WAIT_CHUNK: Duration = Duration::from_secs(30);

/// Дедлайн `pg_ctl start -w`: recovery на медленных офисных дисках может
/// идти дольше дефолтных 60 секунд pg_ctl.
pub const PG_START_TIMEOUT: Duration = Duration::from_secs(180);

/// Общий дедлайн наблюдения за штатной остановкой PostgreSQL
/// (pg_ctl stop + запас на доведение Job до конца).
pub const PG_STOP_OBSERVATION: Duration = Duration::from_secs(520);

/// Интервал проб остановки PostgreSQL внутри дедлайна PG_STOP_OBSERVATION.
pub const PG_STOP_POLL_INTERVAL: Duration = Duration::from_secs(1);

// --- Сервисный режим (orion-runtime serve, диагностика) ---

/// Интервал опроса слушающих портов в serve().
pub const RUNTIME_LISTEN_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// Чанк ожидания завершения launcher-процесса при остановке serve().
pub const RUNTIME_STOP_WAIT_CHUNK: Duration = Duration::from_secs(60);
