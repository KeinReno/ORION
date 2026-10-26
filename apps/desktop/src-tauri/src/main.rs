// ORION desktop shell starts its bundled local API and PostgreSQL runtime.
// Product logic remains in apps/api; database and documents stay in LocalAppData.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;
mod startup;
#[cfg_attr(debug_assertions, allow(dead_code))]
mod payload_ui;
#[cfg(debug_assertions)]
mod browser_smoke;
#[cfg(debug_assertions)]
mod payload_ui_smoke;
#[cfg(debug_assertions)]
mod startup_smoke;

#[cfg(all(windows, not(debug_assertions)))]
fn ready() -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr: SocketAddr = "127.0.0.1:4000".parse().unwrap();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    if stream
        .write_all(b"GET /system/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut body = String::new();
    stream.read_to_string(&mut body).is_ok()
        && body.starts_with("HTTP/1.1 200")
        && body.contains("\"database\":\"ok\"")
}

#[cfg(all(windows, not(debug_assertions)))]
fn start_local_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    use std::fs::{self, OpenOptions};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::Manager;

    if ready() {
        return Ok(());
    }
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let runtime = resource_dir.join("runtime");
    let node = runtime.join("node.exe");
    let launcher = runtime.join("launcher.cjs");
    if !node.is_file() || !launcher.is_file() {
        return Err(format!(
            "Установщик неполный: нет {} или {}",
            node.display(),
            launcher.display()
        ));
    }
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let phase_file = data_dir.join("startup-state.json");
    let _ = fs::remove_file(&phase_file);
    let log_file = data_dir.join("launcher.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| e.to_string())?;
    let mut child = Command::new(node)
        .arg(launcher)
        .current_dir(&runtime)
        .env("ORION_DESKTOP_DATA_DIR", &data_dir)
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(360);
    while Instant::now() < deadline {
        startup::update_phase(app, &phase_file);
        if ready() {
            return Ok(());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!(
                "Локальный сервер завершился ({status}). Журнал: {}",
                log_file.display()
            ));
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err(format!(
        "Локальный сервер не запустился за 360 секунд. Журнал: {}",
        log_file.display()
    ))
}

/// `orion://open?type=note&id=…&workspace=…` (a link an AI agent handed to the person) → the web client's `/open`
/// route, which switches workspace and focuses the object. Navigation only: the page loads the record through the
/// access-checked API. Anything that is not exactly `orion://open?…` is ignored.
fn open_orion_link(app: &tauri::AppHandle, url: &str) {
    use tauri::Manager;
    let Some(query) = url.strip_prefix("orion://open?") else {
        return;
    };
    if !startup::ready(app) {
        if let Ok(mut pending) = PENDING_LINK.lock() { *pending = Some(url.to_owned()); }
        return;
    }
    if let Some(webview) = app.get_webview("main") {
        let window = webview.window();
        // serde_json quotes and escapes the string, so the query cannot break out of the JS literal.
        if let Ok(target) = serde_json::to_string(&format!("/open?{query}")) {
            let _ = webview.eval(&format!("window.location.assign({target})"));
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// A link that LAUNCHED the app (cold start): the window is not loaded yet, so it waits here until the first page load.
static PENDING_LINK: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(all(windows, not(debug_assertions)))]
    let builder = builder.register_asynchronous_uri_scheme_protocol("tauri", |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        tauri::async_runtime::spawn_blocking(move || responder.respond(payload_ui::respond(&app, request)));
    });
    #[cfg(debug_assertions)]
    let builder = if payload_ui_smoke::enabled() || startup::smoke_enabled() {
        builder.register_asynchronous_uri_scheme_protocol("tauri", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || responder.respond(payload_ui::respond(&app, request)));
        })
    } else { builder };
    builder
        .manage(startup::State::default())
        .invoke_handler(tauri::generate_handler![browser::browser_open, browser::browser_control])
        .on_page_load(|webview, payload| {
            #[cfg(debug_assertions)]
            browser_smoke::loaded(webview, &payload);
            #[cfg(debug_assertions)]
            payload_ui_smoke::loaded(webview, &payload);
            #[cfg(debug_assertions)]
            startup_smoke::loaded(webview, &payload);
            if webview.label().starts_with("browser-") { return; }
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && !payload.url().path().starts_with(startup::PATH) {
                let pending = PENDING_LINK.lock().ok().and_then(|mut slot| slot.take());
                if let Some(url) = pending {
                    open_orion_link(tauri::Manager::app_handle(webview), &url);
                }
            }
        })
        // Must be first: a second launch (the OS opening an orion:// link) hands its arguments to the running window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                open_orion_link(app, &arg);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let (Some(url), Ok(mut slot)) = (urls.first(), PENDING_LINK.lock()) {
                    *slot = Some(url.to_string());
                }
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    open_orion_link(&handle, url.as_str());
                }
            });
            // The installer registers the scheme; in a dev build register it at run time.
            #[cfg(all(windows, debug_assertions))]
            if std::env::var_os("ORION_BROWSER_SMOKE").is_none() && !payload_ui_smoke::enabled() && !startup::smoke_enabled() {
                let _ = app.deep_link().register_all();
            }
            #[cfg(debug_assertions)]
            payload_ui_smoke::setup(app)?;
            #[cfg(debug_assertions)]
            startup_smoke::setup(app)?;
            let mut config = app.config().app.windows[0].clone();
            #[cfg(all(windows, not(debug_assertions)))]
            { config.url = tauri::WebviewUrl::App(startup::PATH.into()); }
            #[cfg(debug_assertions)]
            if startup::smoke_enabled() { config.url = tauri::WebviewUrl::App(startup::PATH.into()); }
            let window = tauri::WebviewWindowBuilder::from_config(app, &config)?;
            #[cfg(debug_assertions)]
            let window = if payload_ui_smoke::enabled() { window.initialization_script(payload_ui_smoke::FAKE_API) } else { window };
            window.build()?;
            #[cfg(all(windows, not(debug_assertions)))]
            {
                let handle = app.handle().clone();
                // setup must return immediately so Windows can paint and process input.
                std::thread::spawn(move || match start_local_runtime(&handle) {
                    Ok(()) => {
                        startup::set(&handle, "ready", None);
                        payload_ui::watch_selection(handle);
                    }
                    Err(message) => startup::set(&handle, "error", Some(message)),
                });
            }
            #[cfg(debug_assertions)]
            if startup::smoke_enabled() {
                if app.config().identifier != "com.orion.startup-smoke" { return Err("Isolated startup identifier required".into()); }
                let handle=app.handle().clone();
                std::thread::spawn(move || {
                    for phase in ["database", "migrations", "server"] {
                        std::thread::sleep(std::time::Duration::from_secs(2));
                        startup::set(&handle, phase, None);
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    if std::env::var("ORION_STARTUP_SMOKE").as_deref() == Ok("error") {
                        startup::set(&handle, "error", Some("Контрольная ошибка: локальный сервер недоступен. Данные не изменялись.".into()));
                    } else { startup::set(&handle, "ready", None); }
                });
            } else { startup::set(app.handle(), "ready", None); }
            #[cfg(debug_assertions)]
            if payload_ui_smoke::enabled() { payload_ui::watch_selection(app.handle().clone()); }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running orion desktop shell");
}
