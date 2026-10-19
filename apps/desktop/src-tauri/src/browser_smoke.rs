//! Opt-in native integration smoke. Run a debug build with ORION_BROWSER_SMOKE=1 and a separate app identifier.
//! No keyboard/mouse automation, profiles, credentials or application database are used.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, Webview};
static STARTED: AtomicBool = AtomicBool::new(false);

pub fn loaded(view: &Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    if std::env::var_os("ORION_BROWSER_SMOKE").is_none()
        || view.app_handle().config().identifier != "com.orion.browser-smoke"
    {
        return;
    }
    eprintln!(
        "BROWSER_SMOKE page label={} host={} finished={}",
        view.label(),
        payload.url().host_str().unwrap_or(""),
        matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
    );
    if view.label() != "main"
        || !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
        || STARTED.swap(true, Ordering::SeqCst)
    {
        return;
    }
    let owner = view.clone();
    std::thread::spawn(move || {
        let app = owner.app_handle().clone();
        let result = tauri::async_runtime::block_on(async {
            let id = "NativeSmoke".to_string();
            let bounds = || {
                serde_json::from_value(serde_json::json!({"x":20,"y":100,"width":800,"height":500}))
                    .unwrap()
            };
            super::browser::browser_open(
                owner.clone(),
                id.clone(),
                "https://example.com/".into(),
                bounds(),
            )
            .await?;
            eprintln!("BROWSER_SMOKE open OK");
            for action in ["hide", "show"] {
                super::browser::browser_control(
                    owner.clone(),
                    id.clone(),
                    action.into(),
                    None,
                    Some(bounds()),
                )
                .await?;
                eprintln!("BROWSER_SMOKE {action} OK");
            }
            std::thread::sleep(std::time::Duration::from_secs(4));
            super::browser::browser_control(
                owner.clone(),
                id.clone(),
                "navigate".into(),
                Some("https://www.google.com/search?q=orion".into()),
                None,
            )
            .await?;
            eprintln!("BROWSER_SMOKE navigate OK");
            std::thread::sleep(std::time::Duration::from_secs(5));
            for action in ["reload", "close"] {
                super::browser::browser_control(
                    owner.clone(),
                    id.clone(),
                    action.into(),
                    None,
                    None,
                )
                .await?;
                eprintln!("BROWSER_SMOKE {action} OK");
            }
            Ok::<(), String>(())
        });
        match result {
            Ok(()) => {
                eprintln!("BROWSER_SMOKE PASS");
                app.exit(0);
            }
            Err(error) => {
                eprintln!("BROWSER_SMOKE FAIL: {error}");
                app.exit(1);
            }
        }
    });
}
