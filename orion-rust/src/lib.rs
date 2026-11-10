//! Изоляция эксперимента ORION Rust от установленной beta.
//!
//! Каталог данных и порты берутся из `edition.json`. Обычный ORION
//! (`%LOCALAPPDATA%\\ORION`, API 4000, PostgreSQL 55432) этот процесс не занимает
//! и не читает. Команда `supervise` напрямую владеет PostgreSQL и API через Rust
//! Job Objects; `supervise-launcher` оставлен для диагностики.

use axum::{extract::State, routing::get, Json, Router};
use serde_json::Value;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(windows)]
pub mod lifecycle;
#[cfg(windows)]
pub mod runtime_compat;
pub mod rust_api;
pub mod rust_api_supervisor;
pub mod rust_payload;
pub mod rust_payload_supervisor;
#[cfg(windows)]
pub mod supervisor;

#[cfg(windows)]
pub use lifecycle::restore_staged_backup;

const EDITION_JSON: &str = include_str!("../edition.json");

#[derive(Clone, Debug)]
pub struct Edition {
    pub edition: String,
    pub product_name: String,
    pub identifier: String,
    pub data_dir_name: String,
    pub api_port: u16,
    pub pg_port: u16,
    pub runtime_port: u16,
    pub forbidden_api_port: u16,
    pub forbidden_pg_port: u16,
    pub scheme: String,
}

#[derive(Clone, Debug)]
pub struct Profile {
    pub edition: String,
    pub product_name: String,
    pub data_dir: PathBuf,
    pub api_port: u16,
    pub pg_port: u16,
    pub runtime_port: u16,
}

#[derive(Clone)]
struct RuntimeState {
    profile: Profile,
    started: Instant,
    started_at: String,
}

pub fn edition() -> Edition {
    let value: Value = serde_json::from_str(EDITION_JSON).expect("orion-rust/edition.json");
    let port = |key: &str| value[key].as_u64().unwrap_or(0) as u16;
    Edition {
        edition: value["edition"].as_str().unwrap_or("").to_owned(),
        product_name: value["productName"].as_str().unwrap_or("").to_owned(),
        identifier: value["identifier"].as_str().unwrap_or("").to_owned(),
        data_dir_name: value["dataDirName"].as_str().unwrap_or("").to_owned(),
        api_port: port("apiPort"),
        pg_port: port("pgPort"),
        runtime_port: port("runtimePort"),
        forbidden_api_port: port("forbiddenApiPort"),
        forbidden_pg_port: port("forbiddenPgPort"),
        scheme: value["scheme"].as_str().unwrap_or("").to_owned(),
    }
}

pub fn load_profile() -> Result<Profile, String> {
    let edition = edition();
    let base = local_app_data()?;
    let production = base.join("ORION");
    let data_dir = std::env::var_os("ORION_DESKTOP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join(&edition.data_dir_name));
    let profile = Profile {
        edition: edition.edition,
        product_name: edition.product_name,
        data_dir: resolve_existing_ancestor(&data_dir)?,
        api_port: env_port("ORION_DESKTOP_API_PORT", edition.api_port)?,
        pg_port: env_port("ORION_DESKTOP_PG_PORT", edition.pg_port)?,
        runtime_port: env_port("ORION_RUST_RUNTIME_PORT", edition.runtime_port)?,
    };
    assert_isolated(
        &profile,
        &production,
        edition.forbidden_api_port,
        edition.forbidden_pg_port,
    )?;
    assert_isolated(
        &profile,
        &base.join("com.orion.desktop"),
        edition.forbidden_api_port,
        edition.forbidden_pg_port,
    )?;
    #[cfg(windows)]
    {
        let program_data =
            std::env::var_os("ProgramData").unwrap_or_else(|| "C:\\ProgramData".into());
        assert_isolated(
            &profile,
            &PathBuf::from(program_data).join("ORION"),
            edition.forbidden_api_port,
            edition.forbidden_pg_port,
        )?;
    }
    Ok(profile)
}

pub fn assert_isolated(
    profile: &Profile,
    production: &Path,
    forbidden_api: u16,
    forbidden_pg: u16,
) -> Result<(), String> {
    let data = norm(&resolve_existing_ancestor(&profile.data_dir)?);
    let prod = norm(&resolve_existing_ancestor(production)?);
    if data == prod || data.starts_with(&(prod.clone() + "\\")) {
        return Err(format!(
            "ORION Rust не использует каталог обычного ORION ({}).",
            production.display()
        ));
    }
    if [profile.api_port, profile.pg_port, profile.runtime_port]
        .iter()
        .any(|port| *port == forbidden_api || *port == forbidden_pg || *port == 5433)
    {
        return Err(format!(
            "ORION Rust не занимает порты обычного ORION (API {forbidden_api}, PostgreSQL {forbidden_pg} или dev 5433)."
        ));
    }
    if profile.runtime_port == profile.api_port
        || profile.runtime_port == profile.pg_port
        || profile.api_port == profile.pg_port
    {
        return Err(
            "Порты API, PostgreSQL и диагностики ORION Rust должны различаться.".to_owned(),
        );
    }
    if profile.api_port == 0 || profile.pg_port == 0 || profile.runtime_port == 0 {
        return Err("В orion-rust/edition.json не задан порт.".to_owned());
    }
    Ok(())
}

pub async fn serve(profile: Profile) -> Result<(), String> {
    std::fs::create_dir_all(&profile.data_dir)
        .map_err(|error| format!("Не удалось создать каталог данных: {error}"))?;
    let marker = serde_json::json!({
        "edition": profile.edition,
        "productName": profile.product_name,
        "dataDir": profile.data_dir,
        "apiPort": profile.api_port,
        "pgPort": profile.pg_port,
        "runtimePort": profile.runtime_port,
        "nest": "launcher",
        "postgres": "launcher",
    });
    std::fs::write(
        profile.data_dir.join("rust-runtime.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    )
    .map_err(|error| format!("Не удалось записать rust-runtime.json: {error}"))?;

    let state = Arc::new(RuntimeState {
        profile: profile.clone(),
        started: Instant::now(),
        started_at: chrono::Utc::now().to_rfc3339(),
    });
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/profile", get(profile_view))
        .route("/v1/diagnostics", get(diagnostics))
        .with_state(state);
    let address = format!("127.0.0.1:{}", profile.runtime_port);
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .map_err(|error| format!("Диагностика не слушаёт {address}: {error}"))?;
    axum::serve(listener, app)
        .await
        .map_err(|error| format!("Сервер диагностики остановился: {error}"))
}

async fn health() -> Json<Value> {
    Json(serde_json::json!({ "status": "ok", "edition": "orion-rust" }))
}

async fn profile_view(State(state): State<Arc<RuntimeState>>) -> Json<Value> {
    Json(public_profile(&state.profile))
}

async fn diagnostics(State(state): State<Arc<RuntimeState>>) -> Json<Value> {
    let api_up = listening(state.profile.api_port).await;
    let pg_up = listening(state.profile.pg_port).await;
    Json(serde_json::json!({
        "edition": state.profile.edition,
        "phase": "runtime-ready",
        "startedAt": state.started_at,
        "uptimeMs": state.started.elapsed().as_millis(),
        "apiPort": state.profile.api_port,
        "apiListening": api_up,
        "pgPort": state.profile.pg_port,
        "postgresListening": pg_up,
        "runtimePort": state.profile.runtime_port,
        "dataDir": state.profile.data_dir,
        "nest": "not-started-by-this-process",
        "postgres": "not-started-by-this-process",
        "productionDataUntouched": true,
    }))
}

fn public_profile(profile: &Profile) -> Value {
    serde_json::json!({
        "edition": profile.edition,
        "productName": profile.product_name,
        "dataDir": profile.data_dir,
        "apiPort": profile.api_port,
        "pgPort": profile.pg_port,
        "runtimePort": profile.runtime_port,
    })
}

async fn listening(port: u16) -> bool {
    tokio::time::timeout(
        Duration::from_millis(200),
        tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)),
    )
    .await
    .ok()
    .and_then(|result| result.ok())
    .is_some()
}

fn local_app_data() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("LOCALAPPDATA") {
        return Ok(PathBuf::from(value));
    }
    let home = std::env::var_os("USERPROFILE")
        .ok_or("Не задан LOCALAPPDATA, каталог данных ORION Rust неизвестен.")?;
    Ok(PathBuf::from(home).join("AppData").join("Local"))
}

fn env_port(name: &str, default: u16) -> Result<u16, String> {
    match std::env::var(name) {
        Ok(value) if value.is_empty() => Ok(default),
        Ok(value) => value
            .parse::<u16>()
            .map_err(|_| format!("{name} должен быть портом, получено «{value}».")),
        Err(_) => Ok(default),
    }
}

fn norm(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_start_matches("\\\\?\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

// Resolve links in the longest existing prefix, including when the destination
// itself has not been created yet. Never create anything during validation.
fn resolve_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!(
            "Каталог данных должен быть абсолютным: {}",
            path.display()
        ));
    }
    let mut lexical = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !lexical.pop() {
                    return Err("Недопустимый путь данных.".into());
                }
            }
            other => lexical.push(other.as_os_str()),
        }
    }
    let mut ancestor = lexical.as_path();
    let mut suffix = Vec::new();
    loop {
        match std::fs::canonicalize(ancestor) {
            Ok(mut resolved) => {
                for part in suffix.iter().rev() {
                    resolved.push(part);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = ancestor.file_name() else {
                    return Err(format!(
                        "Не удалось проверить путь {}: {error}",
                        path.display()
                    ));
                };
                suffix.push(name.to_os_string());
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| format!("Не удалось проверить путь {}", path.display()))?;
            }
            Err(error) => {
                return Err(format!(
                    "Не удалось проверить путь {}: {error}",
                    path.display()
                ))
            }
        }
    }
}

#[cfg(windows)]
pub fn supervise_direct(profile: &Profile) -> Result<(), String> {
    lifecycle::supervise_direct(profile)
}

pub fn supervise_packaged_runtime(profile: &Profile) -> Result<(), String> {
    let runtime_root = std::env::var("ORION_RUNTIME_ROOT").map_err(|_| {
        "Задайте ORION_RUNTIME_ROOT — каталог packaged runtime с node.exe и launcher.cjs".to_owned()
    })?;
    let root = PathBuf::from(&runtime_root);
    if !root.is_absolute() {
        return Err("ORION_RUNTIME_ROOT должен быть абсолютным".to_owned());
    }
    let node = root.join("node.exe");
    let launcher = root.join("launcher.cjs");
    if !node.is_file() || !launcher.is_file() {
        return Err("В каталоге runtime нет node.exe или launcher.cjs".to_owned());
    }
    std::env::set_var("ORION_DESKTOP_DATA_DIR", &profile.data_dir);
    std::env::set_var("ORION_DESKTOP_API_PORT", profile.api_port.to_string());
    std::env::set_var("ORION_DESKTOP_PG_PORT", profile.pg_port.to_string());
    std::env::set_var("ORION_RUST_RUNTIME_PORT", profile.runtime_port.to_string());
    std::env::set_var("ORION_EDITION", "rust");
    let mut owned = supervisor::Supervisor::new().map_err(|error| error.to_string())?;
    let spec = supervisor::ProcessSpec::new(node)
        .arg(launcher)
        .current_dir(&root);
    let pid = owned.spawn(spec).map_err(|error| error.to_string())?;
    loop {
        match owned
            .wait_for_exit(pid, Duration::from_secs(60))
            .map_err(|error| error.to_string())?
        {
            Some(code) => {
                let _ = owned.terminate_all();
                return if code == 0 {
                    Ok(())
                } else {
                    Err(format!("runtime завершился с кодом {code}"))
                };
            }
            None => continue,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(data: &str, api: u16, pg: u16, runtime: u16) -> Profile {
        Profile {
            edition: "orion-rust".into(),
            product_name: "ORION Rust".into(),
            data_dir: PathBuf::from(data),
            api_port: api,
            pg_port: pg,
            runtime_port: runtime,
        }
    }

    #[test]
    fn edition_file_keeps_the_experiment_off_beta_ports() {
        let edition = edition();
        assert_eq!(edition.edition, "orion-rust");
        assert_eq!(edition.data_dir_name, "ORION-Rust");
        assert_eq!(edition.api_port, 14000);
        assert_eq!(edition.pg_port, 55442);
        assert_eq!(edition.runtime_port, 14099);
        assert_eq!(edition.forbidden_api_port, 4000);
        assert_eq!(edition.forbidden_pg_port, 55432);
        assert_ne!(edition.identifier, "com.orion.desktop");
    }

    #[test]
    fn default_profile_is_outside_the_installed_data_dir() {
        let production = PathBuf::from(r"C:\Users\Reno\AppData\Local\ORION");
        let profile = sample(
            r"C:\Users\Reno\AppData\Local\ORION-Rust",
            14000,
            55442,
            14099,
        );
        assert!(assert_isolated(&profile, &production, 4000, 55432).is_ok());
    }

    #[test]
    fn production_directory_and_its_children_are_refused() {
        let production = PathBuf::from(r"C:\Users\Reno\AppData\Local\ORION");
        let exact = sample(r"C:\Users\Reno\AppData\Local\ORION", 14000, 55442, 14099);
        let child = sample(
            r"C:\Users\Reno\AppData\Local\ORION\postgres",
            14000,
            55442,
            14099,
        );
        assert!(assert_isolated(&exact, &production, 4000, 55432).is_err());
        assert!(assert_isolated(&child, &production, 4000, 55432).is_err());
    }

    #[test]
    fn beta_ports_are_refused() {
        let production = PathBuf::from(r"C:\Users\Reno\AppData\Local\ORION");
        let api = sample(
            r"C:\Users\Reno\AppData\Local\ORION-Rust",
            4000,
            55442,
            14099,
        );
        let pg = sample(
            r"C:\Users\Reno\AppData\Local\ORION-Rust",
            14000,
            55432,
            14099,
        );
        assert!(assert_isolated(&api, &production, 4000, 55432).is_err());
        assert!(assert_isolated(&pg, &production, 4000, 55432).is_err());
    }

    #[test]
    fn port_collisions_and_classic_ports_in_any_role_are_refused() {
        let production = PathBuf::from(r"C:\Users\Reno\AppData\Local\ORION");
        for (api, pg, runtime) in [
            (14000, 14000, 14099),
            (55432, 55442, 14099),
            (14000, 4000, 14099),
            (14000, 55442, 4000),
            (14000, 5433, 14099),
        ] {
            assert!(assert_isolated(
                &sample(r"C:\Users\Reno\AppData\Local\ORION-Rust", api, pg, runtime),
                &production,
                4000,
                55432
            )
            .is_err());
        }
    }

    #[test]
    fn dot_segments_cannot_escape_into_classic_directory() {
        let production = PathBuf::from(r"C:\Users\Reno\AppData\Local\ORION");
        let profile = sample(
            r"C:\Users\Reno\AppData\Local\ORION-Rust\..\ORION\postgres",
            14000,
            55442,
            14099,
        );
        assert!(assert_isolated(&profile, &production, 4000, 55432).is_err());
    }
}
