//! Keep the existing trusted tauri origin for main, detached panels and workspaces.
//! The immutable launcher verifies the selected root before the shell opens a window.
use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use tauri::{http, Manager};

fn file_path(root: &Path, uri: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(uri).decode_utf8().ok()?;
    if decoded.contains('\\') || decoded.contains(':') || decoded.contains('\0') { return None; }
    let rel = decoded.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    if Path::new(rel).components().any(|c| !matches!(c, Component::Normal(_))) { return None; }
    let mut file = root.join(rel);
    if !file.is_file() && file.extension().is_none() { file.set_extension("html"); }
    let canonical = file.canonicalize().ok()?;
    if !canonical.starts_with(root.canonicalize().ok()?) { return None; }
    Some(canonical)
}

pub(crate) fn csp(html: &str) -> String {
    // Next's inline bootstrap varies with each export. Hash the actual signed HTML,
    // never reuse hashes from the UI embedded in the old executable.
    let mut scripts = String::new();
    let mut rest = html;
    while let Some(start) = rest.find("<script") {
        rest = &rest[start..];
        let Some(open) = rest.find('>') else { break; };
        rest = &rest[open + 1..];
        let Some(close) = rest.find("</script>") else { break; };
        // HTML parsing normalizes CRLF/CR to LF before CSP checks inline scripts.
        let script = rest[..close].replace("\r\n", "\n").replace('\r', "\n");
        let hash = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script.as_bytes()));
        scripts.push_str(&format!(" 'sha256-{hash}'"));
        rest = &rest[close + 9..];
    }
    format!("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'{scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' blob: ipc: http://ipc.localhost https://ipc.localhost http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src http: https:; frame-ancestors 'none'")
}

pub fn respond(app: &tauri::AppHandle, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    if let Some(response) = super::startup::respond(app, &request) { return response; }
    let result = (|| {
        if !matches!(request.method().as_str(), "GET" | "HEAD") { return None; }
        let marker = app.path().app_local_data_dir().ok()?.join("app-runtime.json");
        let state: serde_json::Value = serde_json::from_slice(&std::fs::read(marker).ok()?).ok()?;
        let root = PathBuf::from(state.get("web")?.as_str()?);
        let file = file_path(&root, request.uri().path())?;
        let bytes = std::fs::read(&file).ok()?;
        let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("");
        let mime = match ext {
            "html" => "text/html; charset=utf-8", "js" | "mjs" => "text/javascript; charset=utf-8",
            "css" => "text/css; charset=utf-8", "json" => "application/json", "txt" => "text/plain; charset=utf-8",
            "svg" => "image/svg+xml", "png" => "image/png", "ico" => "image/x-icon", "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp", "avif" => "image/avif", "gif" => "image/gif", "woff2" => "font/woff2",
            "woff" => "font/woff", "ttf" => "font/ttf", "wasm" => "application/wasm", "mp4" => "video/mp4",
            "mp3" => "audio/mpeg", "wav" => "audio/wav", _ => "application/octet-stream",
        };
        let mut response = http::Response::builder().header("Content-Type", mime)
            .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
        if ext == "html" { response = response.header("Content-Security-Policy", csp(std::str::from_utf8(&bytes).ok()?)); }
        response.body(if request.method() == "HEAD" { vec![] } else { bytes }).ok()
    })();
    result.unwrap_or_else(|| http::Response::builder().status(404).body(Vec::new()).unwrap())
}

pub fn watch_selection(app: tauri::AppHandle) {
    // A broken JS bundle cannot reload itself after rollback. The shell watches
    // the launcher's marker independently and reloads only trusted ORION views.
    std::thread::spawn(move || {
        let Ok(dir) = app.path().app_local_data_dir() else { return; };
        let marker = dir.join("app-runtime.json");
        let mut previous = std::fs::read(&marker).unwrap_or_default();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if let Ok(current) = std::fs::read(&marker) {
                if current != previous {
                    previous = current;
                    for (label, view) in app.webviews() {
                        if label == "main" || label.starts_with("panel-") || label.starts_with("workspace-") {
                            let _ = view.eval("window.location.reload()");
                        }
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hashes_inline_scripts_without_unsafe_inline_script_policy() {
        let policy = csp("<script>hello()</script><script src='/app.js'></script>");
        assert!(policy.contains(&base64::engine::general_purpose::STANDARD.encode(Sha256::digest(b"hello()"))));
        assert!(!policy.split(';').find(|s| s.contains("script-src")).unwrap().contains("unsafe-inline"));
    }
    #[test]
    fn traversal_and_windows_separators_are_rejected() {
        for uri in ["/%2e%2e/private", "/%5cprivate", "/C:/secret", "/%00"] {
            assert!(file_path(Path::new("."), uri).is_none());
        }
    }
    #[test]
    fn script_hashes_match_html_newline_normalization() {
        let policy = csp("<script>first();\r\nsecond();\rthird();</script>");
        let hash = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(b"first();\nsecond();\nthird();"));
        assert!(policy.contains(&hash));
    }
}
