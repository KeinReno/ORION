// ORION desktop shell starts its bundled local API and PostgreSQL runtime.
// Product logic remains in apps/api; database and documents stay in LocalAppData.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;
#[cfg(debug_assertions)]
mod browser_smoke;
#[cfg_attr(debug_assertions, allow(dead_code))]
mod payload_ui;
#[cfg(debug_assertions)]
mod payload_ui_smoke;
mod startup;
#[cfg(debug_assertions)]
mod startup_smoke;

#[cfg(all(windows, not(debug_assertions)))]
use orion_runtime::supervisor as process_supervisor;
#[cfg(all(windows, debug_assertions))]
use orion_runtime as _;

#[cfg(all(windows, not(debug_assertions)))]
static RUNTIME_STDIN: std::sync::Mutex<Option<std::fs::File>> = std::sync::Mutex::new(None);
#[cfg(all(windows, not(debug_assertions)))]
static RUNTIME_DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(all(windows, not(debug_assertions)))]
static EXIT_ALLOWED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(all(windows, not(debug_assertions)))]
static EXIT_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(all(windows, not(debug_assertions)))]
fn runtime_pipe() -> Result<(std::fs::File, std::fs::File), String> {
    use std::os::windows::io::FromRawHandle;
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn CreatePipe(read: *mut *mut c_void, write: *mut *mut c_void, attributes: *mut c_void, size: u32) -> i32;
    }
    let (mut read, mut write) = (std::ptr::null_mut(), std::ptr::null_mut());
    if unsafe { CreatePipe(&mut read, &mut write, std::ptr::null_mut(), 0) } == 0 {
        return Err(format!("Не удалось создать канал остановки runtime: {}", std::io::Error::last_os_error()));
    }
    Ok(unsafe { (std::fs::File::from_raw_handle(read), std::fs::File::from_raw_handle(write)) })
}

#[cfg(all(windows, not(debug_assertions)))]
fn edition_ports() -> Result<(u16, u16), String> {
    let edition = orion_runtime::edition()?;
    Ok((edition.api_port, edition.pg_port))
}

#[cfg(all(windows, not(debug_assertions)))]
fn health_responds(api_port: u16) -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], api_port));
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
fn listener_pids(port: u16) -> Result<Vec<u32>, String> {
    use std::ffi::c_void;

    const AF_INET: i32 = 2;
    const TCP_TABLE_OWNER_PID_LISTENER: i32 = 3;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

    #[link(name = "iphlpapi")]
    unsafe extern "system" {
        fn GetExtendedTcpTable(
            table: *mut c_void,
            size: *mut u32,
            order: i32,
            family: i32,
            table_class: i32,
            reserved: u32,
        ) -> u32;
    }

    for _ in 0..3 {
        let mut bytes = 0u32;
        let status = unsafe {
            GetExtendedTcpTable(
                std::ptr::null_mut(),
                &mut bytes,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if status != ERROR_INSUFFICIENT_BUFFER || bytes < 4 {
            return Err(format!(
                "Не удалось проверить владельца порта {port} (TCP table status {status})."
            ));
        }
        let mut buffer = vec![0u8; bytes as usize];
        let mut actual = bytes;
        let status = unsafe {
            GetExtendedTcpTable(
                buffer.as_mut_ptr().cast(),
                &mut actual,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if status == 0 {
            let count = unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<u32>()) as usize };
            if 4usize.saturating_add(count.saturating_mul(24)) > buffer.len() {
                return Err(format!("Таблица владельцев TCP-порта {port} повреждена."));
            }
            let mut pids = Vec::new();
            for index in 0..count {
                let row = unsafe { buffer.as_ptr().add(4 + index * 24) };
                let address = unsafe { (*row.add(4), *row.add(5), *row.add(6), *row.add(7)) };
                let local_port = unsafe { (*row.add(8) as u16) << 8 | *row.add(9) as u16 };
                let loopback_or_wildcard = address == (127, 0, 0, 1) || address == (0, 0, 0, 0);
                if local_port == port && loopback_or_wildcard {
                    let pid = unsafe { std::ptr::read_unaligned(row.add(20).cast::<u32>()) };
                    pids.push(pid);
                }
            }
            pids.sort_unstable();
            pids.dedup();
            return Ok(pids);
        }
        if status != ERROR_INSUFFICIENT_BUFFER {
            return Err(format!(
                "Не удалось проверить владельца порта {port} (TCP table status {status})."
            ));
        }
    }
    Err(format!(
        "Таблица TCP менялась во время проверки порта {port}."
    ))
}

fn listeners_owned_by_job(
    pids: &[u32],
    mut owns_pid: impl FnMut(u32) -> Result<bool, String>,
) -> Result<bool, String> {
    if pids.is_empty() {
        return Ok(false);
    }
    for pid in pids {
        if !owns_pid(*pid)? {
            return Err(format!(
                "Listener PID {pid} не принадлежит экземпляру ORION Rust, запущенному сейчас."
            ));
        }
    }
    Ok(true)
}

fn reject_occupied_port(name: &str, port: u16, pids: &[u32]) -> Result<(), String> {
    if pids.is_empty() {
        return Ok(());
    }
    let owners = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!("Порт {name} {port} уже занят (PID: {owners}). ORION Rust не подключался и ничего не останавливал."))
}

#[cfg(all(windows, not(debug_assertions)))]
fn start_local_runtime(
    app: &tauri::AppHandle,
) -> Result<(process_supervisor::Supervisor, u32), String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::os::windows::io::AsRawHandle;
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::Manager;

    let (api_port, pg_port) = edition_ports()?;
    for (name, port) in [("API", api_port), ("PostgreSQL", pg_port)] {
        let pids = listener_pids(port)?;
        reject_occupied_port(name, port, &pids)?;
    }
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let runtime = resource_dir.join("runtime");
    let runtime_exe = runtime.join("orion-runtime.exe");
    if !runtime_exe.is_file() {
        return Err(format!(
            "Установщик неполный: нет {}",
            runtime_exe.display()
        ));
    }
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let shutdown_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("Не удалось подготовить сигнал завершения: {error}"))?
        .as_nanos();
    let shutdown_marker = data_dir.join(format!("runtime-stopped-{}-{shutdown_nonce}.marker", std::process::id()));
    let phase_file = data_dir.join("startup-state.json");
    let _ = fs::remove_file(&phase_file);
    let log_file = data_dir.join("launcher.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| e.to_string())?;
    let (stdin, shutdown_writer) = runtime_pipe()?;
    {
        let mut writer = RUNTIME_STDIN.lock().map_err(|e| e.to_string())?;
        if !EXIT_REQUESTED.load(std::sync::atomic::Ordering::SeqCst) {
            *writer = Some(shutdown_writer);
        }
    }
    let process_spec = process_supervisor::ProcessSpec::new(runtime_exe)
        .arg("supervise-direct")
        .current_dir(&runtime)
        .env_inherited("ORION_RUNTIME_ROOT", runtime.as_os_str())
        .env_inherited("ORION_SHUTDOWN_ON_STDIN_EOF", "1")
        .env_inherited("ORION_SHELL_PID", std::process::id().to_string())
        .env_inherited("ORION_SHUTDOWN_MARKER", shutdown_marker.as_os_str())
        .env_inherited("ORION_DESKTOP_DATA_DIR", data_dir.as_os_str())
        .stdio_handles(
            stdin.as_raw_handle() as usize,
            log.as_raw_handle() as usize,
            log.as_raw_handle() as usize,
        );
    let mut supervisor = process_supervisor::Supervisor::new()
        .map_err(|error| format!("Не удалось создать Job для локального runtime: {error}"))?;
    let pid = supervisor
        .spawn(process_spec)
        .map_err(|error| format!("Не удалось безопасно запустить Rust runtime: {error}"))?;
    let started = Instant::now();
    let mut last_phase = String::new();
    let deadline = Instant::now() + Duration::from_secs(360);
    while Instant::now() < deadline {
        startup::update_phase(app, &phase_file);
        let phase = fs::read(&phase_file).ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|value| value.get("phase").and_then(|phase| phase.as_str()).map(str::to_owned));
        if let Some(phase) = phase.filter(|phase| matches!(phase.as_str(), "preparing" | "database" | "migrations" | "server")) {
            if phase != last_phase {
                last_phase = phase;
                if let Ok(mut timing) = OpenOptions::new().create(true).append(true).open(&log_file) {
                    let _ = writeln!(timing, "[startup] phase={} elapsed_ms={}", last_phase, started.elapsed().as_millis());
                }
            }
        }
        if health_responds(api_port) {
            let api_pids = listener_pids(api_port)?;
            let pg_pids = listener_pids(pg_port)?;
            let api_owned = listeners_owned_by_job(&api_pids, |listener_pid| {
                supervisor
                    .owns_pid(listener_pid)
                    .map_err(|error| error.to_string())
            })?;
            let pg_owned = listeners_owned_by_job(&pg_pids, |listener_pid| {
                supervisor
                    .owns_pid(listener_pid)
                    .map_err(|error| error.to_string())
            })?;
            if api_owned && pg_owned {
                if let Ok(mut timing) = OpenOptions::new().create(true).append(true).open(&log_file) {
                    let _ = writeln!(timing, "[startup] phase=ready elapsed_ms={}", started.elapsed().as_millis());
                }
                return Ok((supervisor, pid));
            }
        }
        if let Some(status) = supervisor
            .wait_for_exit(pid, Duration::ZERO)
            .map_err(|error| error.to_string())?
        {
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
    let Some(query) = url.strip_prefix("orion-rust://open?") else {
        return;
    };
    if !startup::ready(app) {
        if let Ok(mut pending) = PENDING_LINK.lock() {
            *pending = Some(url.to_owned());
        }
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

#[cfg(test)]
mod runtime_ownership_tests {
    use super::{listeners_owned_by_job, reject_occupied_port};

    #[test]
    fn occupied_port_is_reported_without_claiming_or_stopping_its_owner() {
        let error = reject_occupied_port("API", 14000, &[73]).unwrap_err();
        assert!(error.contains("14000"));
        assert!(error.contains("73"));
        assert!(error.contains("не останавливал"));
        assert!(reject_occupied_port("API", 14000, &[]).is_ok());
    }

    #[test]
    fn readiness_requires_every_listener_to_belong_to_the_current_job() {
        assert!(!listeners_owned_by_job(&[], |_| Ok(true)).unwrap());
        assert!(listeners_owned_by_job(&[12, 13], |pid| Ok(pid == 12 || pid == 13)).unwrap());
        let error = listeners_owned_by_job(&[12, 99], |pid| Ok(pid == 12)).unwrap_err();
        assert!(error.contains("99"));
        assert!(listeners_owned_by_job(&[12], |_| Err("IsProcessInJob failed".into())).is_err());
    }
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(all(windows, not(debug_assertions)))]
    let builder =
        builder.register_asynchronous_uri_scheme_protocol("tauri", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(payload_ui::respond(&app, request))
            });
        });
    #[cfg(debug_assertions)]
    let builder = if payload_ui_smoke::enabled() || startup::smoke_enabled() {
        builder.register_asynchronous_uri_scheme_protocol("tauri", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(payload_ui::respond(&app, request))
            });
        })
    } else {
        builder
    };
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
        // Closing the main window must end the whole app: Tauri only requests an
        // exit when the LAST window closes, so with a detached sidebar open the
        // shell kept running invisibly and the sidebar survived the "closed" app.
        .on_window_event(|window, event| {
            use tauri::Manager;
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                for (label, other) in window.app_handle().webview_windows() {
                    if label != "main" {
                        let _ = other.close();
                    }
                }
            }
        })
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
            if startup::smoke_enabled() {
                config.url = tauri::WebviewUrl::App(startup::PATH.into());
            } else {
                // Dev build without smoke: load the Next dev server (tauri.conf.json devUrl).
                // App("index.html") would hit the unregistered tauri:// protocol and the
                // webview channel dies with FailedToReceiveMessage — no window appears.
                config.url = tauri::WebviewUrl::External("http://localhost:3011".parse().expect("devUrl"));
            }
            let window = tauri::WebviewWindowBuilder::from_config(app, &config)?;
            #[cfg(debug_assertions)]
            let window = if payload_ui_smoke::enabled() { window.initialization_script(payload_ui_smoke::FAKE_API) } else { window };
            #[cfg(debug_assertions)]
            eprintln!("[orion-debug] building window: label={} size={}x{} visible={} url={:?}",
                config.label, config.width, config.height, config.visible, config.url);
            #[cfg(debug_assertions)]
            let built = window.build();
            #[cfg(debug_assertions)]
            {
                match &built {
                    Ok(w) => eprintln!("[orion-debug] window built: hwnd={:?} size={:?} visible={:?} title={:?}",
                        w.hwnd(), w.inner_size(), w.is_visible(), w.title()),
                    Err(e) => eprintln!("[orion-debug] window build FAILED: {e}"),
                }
            }
            #[cfg(not(debug_assertions))]
            let built = window.build();
            built?;
            #[cfg(all(windows, not(debug_assertions)))]
            {
                let handle = app.handle().clone();
                // setup must return immediately so Windows can paint and process input.
                std::thread::spawn(move || { match start_local_runtime(&handle) {
                    Ok((supervisor, pid)) => {
                        startup::set(&handle, "ready", None);
                        payload_ui::watch_selection(handle.clone());
                        loop {
                            match supervisor.wait_for_exit(pid, std::time::Duration::from_secs(1)) {
                                Ok(Some(code)) => {
                                    startup::set(&handle, "error", Some(format!("Локальный launcher завершился ({code}); дочерние процессы остановлены.")));
                                    break;
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    startup::set(&handle, "error", Some(format!("Не удалось наблюдать за локальным launcher: {error}")));
                                    break;
                                }
                            }
                        }
                    }
                    Err(message) => startup::set(&handle, "error", Some(message)),
                }
                RUNTIME_DONE.store(true, std::sync::atomic::Ordering::SeqCst);
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
        .build(tauri::generate_context!())
        .expect("error while building orion desktop shell")
        .run(|app, event| {
            #[cfg(all(windows, not(debug_assertions)))]
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                use std::sync::atomic::Ordering;
                if EXIT_ALLOWED.load(Ordering::SeqCst) { return; }
                api.prevent_exit();
                if EXIT_REQUESTED.swap(true, Ordering::SeqCst) { return; }
                if let Ok(mut writer) = RUNTIME_STDIN.lock() { writer.take(); }
                let handle = app.clone();
                std::thread::spawn(move || {
                    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(540);
                    let mut reported = false;
                    // Never close the Job while PostgreSQL is still checkpointing.
                    while !RUNTIME_DONE.load(Ordering::SeqCst) {
                        if std::time::Instant::now() >= deadline {
                            if !reported {
                                reported = true;
                                startup::set(&handle, "error", Some("База данных не завершила работу за 9 минут. ORION принудительно завершается; дерево процессов будет остановлено закрытием Job Object.".into()));
                            }
                            // Hard cap: a hung runtime must never keep the shell
                            // open forever. Exiting drops the supervisor, the
                            // kill-on-close Job Object terminates the whole tree.
                            EXIT_ALLOWED.store(true, Ordering::SeqCst);
                            handle.exit(0);
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    EXIT_ALLOWED.store(true, Ordering::SeqCst);
                    handle.exit(0);
                });
            }
            #[cfg(not(all(windows, not(debug_assertions))))]
            let _ = (app, event);
        });
}
