// ORION desktop shell starts its bundled local API and PostgreSQL runtime.
// Product logic remains in apps/api; database and documents stay in LocalAppData.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
fn start_local_runtime(app: &tauri::App) -> Result<(), String> {
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
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
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
        "Локальный сервер не запустился за 180 секунд. Журнал: {}",
        log_file.display()
    ))
}

#[cfg(all(windows, not(debug_assertions)))]
fn show_startup_error(message: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }
    use std::os::windows::ffi::OsStrExt;
    let text: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let caption: Vec<u16> = std::ffi::OsStr::new("ORION не запустился")
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        MessageBoxW(0, text.as_ptr(), caption.as_ptr(), 0x10);
    }
}

/// `orion://open?type=note&id=…&workspace=…` (a link an AI agent handed to the person) → the web client's `/open`
/// route, which switches workspace and focuses the object. Navigation only: the page loads the record through the
/// access-checked API. Anything that is not exactly `orion://open?…` is ignored.
fn open_orion_link(app: &tauri::AppHandle, url: &str) {
    use tauri::Manager;
    let Some(query) = url.strip_prefix("orion://open?") else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        // serde_json quotes and escapes the string, so the query cannot break out of the JS literal.
        if let Ok(target) = serde_json::to_string(&format!("/open?{query}")) {
            let _ = window.eval(&format!("window.location.assign({target})"));
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// A link that LAUNCHED the app (cold start): the window is not loaded yet, so it waits here until the first page load.
static PENDING_LINK: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn main() {
    tauri::Builder::default()
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
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
            let _ = app.deep_link().register_all();
            #[cfg(all(windows, not(debug_assertions)))]
            if let Err(message) = start_local_runtime(app) {
                show_startup_error(&message);
                return Err(std::io::Error::other(message).into());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running orion desktop shell");
}
