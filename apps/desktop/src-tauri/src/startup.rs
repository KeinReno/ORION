//! Shell-owned startup surface: it must render before Node, PostgreSQL or React exist.
use serde::Serialize;
use std::sync::Mutex;
use tauri::{http, Manager};

pub const PATH: &str = "/__orion_startup";
#[derive(Clone, Serialize)]
pub struct Status {
    pub phase: String,
    pub error: Option<String>,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            phase: "preparing".into(),
            error: None,
        }
    }
}
pub type State = Mutex<Status>;

pub fn set(app: &tauri::AppHandle, phase: &str, error: Option<String>) {
    *app.state::<State>().lock().unwrap() = Status {
        phase: phase.into(),
        error,
    };
}
pub fn ready(app: &tauri::AppHandle) -> bool {
    app.state::<State>().lock().unwrap().phase == "ready"
}
#[cfg(all(windows, not(debug_assertions)))]
pub fn update_phase(app: &tauri::AppHandle, file: &std::path::Path) {
    let phase = std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| {
            value
                .get("phase")
                .and_then(|s| s.as_str())
                .map(str::to_owned)
        });
    if let Some(phase) = phase.filter(|p| {
        matches!(
            p.as_str(),
            "preparing" | "database" | "migrations" | "server"
        )
    }) {
        set(app, &phase, None);
    }
}
pub fn respond(
    app: &tauri::AppHandle,
    request: &http::Request<Vec<u8>>,
) -> Option<http::Response<Vec<u8>>> {
    let path = request.uri().path();
    if path != PATH && path != format!("{PATH}/status") && path != format!("{PATH}/logo.png") {
        return None;
    }
    if !matches!(request.method().as_str(), "GET" | "HEAD") {
        return Some(http::Response::builder().status(405).body(vec![]).unwrap());
    }
    let (mime, bytes) = if path.ends_with("/status") {
        (
            "application/json",
            serde_json::to_vec(&*app.state::<State>().lock().unwrap()).unwrap(),
        )
    } else if path.ends_with("/logo.png") {
        (
            "image/png",
            include_bytes!("../../../web/public/kaiden-192.png").to_vec(),
        )
    } else {
        // Shell version is the premiere key: a new installer replays the longer opening once.
        // Payload updates do not ship this page, so they must not reset it.
        (
            "text/html; charset=utf-8",
            include_str!("startup.html")
                .replace("{{STARTUP_EDITION}}", env!("CARGO_PKG_VERSION"))
                .into_bytes(),
        )
    };
    Some(
        http::Response::builder()
            .header("Content-Type", mime)
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header(
                "Content-Security-Policy",
                super::payload_ui::csp(std::str::from_utf8(&bytes).unwrap_or("")),
            )
            .body(if request.method() == "HEAD" {
                vec![]
            } else {
                bytes
            })
            .unwrap(),
    )
}

#[cfg(debug_assertions)]
pub fn smoke_enabled() -> bool {
    std::env::var_os("ORION_STARTUP_SMOKE").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn starts_pending_and_serializes_failures_as_data() {
        assert_eq!(Status::default().phase, "preparing");
        let failed = Status {
            phase: "error".into(),
            error: Some("<script>private path</script>".into()),
        };
        let value: serde_json::Value =
            serde_json::from_slice(&serde_json::to_vec(&failed).unwrap()).unwrap();
        assert_eq!(value["error"], "<script>private path</script>");
    }
    #[test]
    fn startup_page_names_the_shell_edition_and_keeps_the_status_hooks() {
        let html = include_str!("startup.html");
        assert!(html.contains("data-edition=\"{{STARTUP_EDITION}}\""));
        for id in ["main", "stage", "hint", "time", "error", "retry", "skip"] {
            assert!(html.contains(&format!("id=\"{id}\"")), "{id}");
        }
        assert!(html.contains("/__orion_startup/logo.png"));
        assert!(html.contains("prefers-reduced-motion"));
        let served = html.replace("{{STARTUP_EDITION}}", env!("CARGO_PKG_VERSION"));
        assert!(!served.contains("{{STARTUP_EDITION}}"));
        assert!(served.contains(env!("CARGO_PKG_VERSION")));
    }
}
