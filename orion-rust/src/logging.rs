//! Структурные события запуска и остановки ORION-R.
//!
//! Человекочитаемый вывод остаётся в launcher.log (eprintln); сюда пишется
//! машиночитаемая копия ключевых событий — JSON Lines в
//! `<data-dir>/runtime.jsonl`: одна строка = одно событие с полями
//! ts/level/stage/msg и любыми дополнительными. Так диагностика у пользователя
//! сводится к фильтру по полям, а не к чтению простыни текста.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

static WRITER: Mutex<Option<File>> = Mutex::new(None);

/// Открывает (или переводит) журнал в каталоге данных. Вызывается один раз
/// в начале supervise-direct; до инициализации события молча пропускаются.
pub fn init(data_dir: &Path) {
    let path = data_dir.join("runtime.jsonl");
    let file = OpenOptions::new().create(true).append(true).open(&path);
    if let Ok(mut guard) = WRITER.lock() {
        *guard = file.ok();
    }
}

/// Одно структурное событие. `fields` мержится в корень записи.
pub fn event(level: &str, stage: &str, message: &str, fields: serde_json::Value) {
    let Ok(mut guard) = WRITER.lock() else { return };
    let Some(file) = guard.as_mut() else { return };
    let mut record = serde_json::json!({
        "ts": humantime(),
        "level": level,
        "stage": stage,
        "msg": message,
    });
    if let (Some(record_map), serde_json::Value::Object(extra)) =
        (record.as_object_mut(), fields)
    {
        record_map.extend(extra);
    }
    let mut line = match serde_json::to_string(&record) {
        Ok(line) => line,
        Err(_) => return,
    };
    line.push('\n');
    let _ = file.write_all(line.as_bytes());
    let _ = file.flush();
}

fn humantime() -> String {
    let Ok(duration) = SystemTime::now().duration_since(std::time::UNIX_EPOCH) else {
        return "unknown".to_owned();
    };
    let secs = duration.as_secs() as i64;
    // RFC3339 без внешних зависимостей: chrono уже есть в зависимостях lib.
    let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0);
    match datetime {
        Some(value) => value.to_rfc3339(),
        None => format!("{secs}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_without_init_is_a_noop() {
        // До init() событие не паникует и никуда не пишет.
        event("info", "test", "no-op", serde_json::json!({}));
    }

    #[test]
    fn event_writes_json_line_with_merged_fields() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("logging-tests")
            .join(format!("orion-logging-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        init(&root);
        event("info", "startup", "probe", serde_json::json!({"elapsedMs": 42}));
        let line = std::fs::read_to_string(root.join("runtime.jsonl")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["level"], "info");
        assert_eq!(parsed["stage"], "startup");
        assert_eq!(parsed["elapsedMs"], 42);
        assert!(parsed["ts"].is_string());
        let _ = std::fs::remove_dir_all(&root);
        // Сброс глобального состояния, чтобы другие тесты не писали в удалённый каталог.
        if let Ok(mut guard) = WRITER.lock() {
            *guard = None;
        }
    }
}
