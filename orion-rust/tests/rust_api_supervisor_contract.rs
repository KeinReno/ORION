#[path = "../src/rust_api.rs"]
mod rust_api;
#[path = "../src/rust_api_supervisor.rs"]
mod rust_api_supervisor;
#[path = "../src/rust_payload.rs"]
mod rust_payload;
#[path = "../src/rust_payload_supervisor.rs"]
mod rust_payload_supervisor;
#[path = "../src/supervisor.rs"]
mod supervisor;
#[path = "../src/timeouts.rs"]
mod timeouts;

use rust_api::{api_mode, LanNodeConfig};
use rust_api_supervisor::{
    supervise_api, ApiCommand, ApiLaunchRequest, ApiSupervisorBackend, ProcessExit,
    SupervisorOutcome, SystemApiBackend,
};
use std::collections::BTreeMap;
use std::collections::VecDeque;
#[cfg(windows)]
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "orion-rust-api-supervisor-{}-{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone)]
struct Script {
    exit: Option<i32>,
    launch_error: Option<String>,
    output: String,
    readiness: VecDeque<bool>,
}

struct FakeProcess(Script);

#[derive(Default)]
struct FakeBackend {
    scripts: VecDeque<Script>,
    node_configs: VecDeque<LanNodeConfig>,
    launched_modes: Vec<String>,
    launched_commands: Vec<ApiCommand>,
    settled: Vec<bool>,
    selected_command: Option<ApiCommand>,
    kill_count: usize,
    sleep_count: usize,
    shutdown: Option<Arc<AtomicBool>>,
    signal_shutdown_on_sleep: bool,
    prepared_commands: Vec<ApiCommand>,
}

impl ApiSupervisorBackend for FakeBackend {
    type Process = FakeProcess;

    fn read_node_config(&mut self) -> LanNodeConfig {
        self.node_configs.pop_front().unwrap_or_default()
    }

    fn launch(&mut self, request: &ApiLaunchRequest) -> Result<Self::Process, String> {
        self.launched_modes.push(request.mode.mode.to_owned());
        self.launched_commands.push(request.command.clone());
        let script = self.scripts.pop_front().expect("launch script");
        if let Some(error) = script.launch_error.clone() {
            return Err(error);
        }
        Ok(FakeProcess(script))
    }

    fn try_wait(&mut self, process: &mut Self::Process) -> Result<Option<ProcessExit>, String> {
        Ok(process.0.exit.map(|code| ProcessExit { code: Some(code) }))
    }

    fn trial_readiness(
        &mut self,
        process: &mut Self::Process,
        _request: &ApiLaunchRequest,
    ) -> Result<bool, String> {
        Ok(process.0.readiness.pop_front().unwrap_or(false))
    }

    fn captured_output(&mut self, process: &mut Self::Process) -> String {
        process.0.output.clone()
    }

    fn kill_and_wait(&mut self, _process: &mut Self::Process) -> Result<(), String> {
        self.kill_count += 1;
        Ok(())
    }

    fn sleep(&mut self, _duration: Duration) {
        self.sleep_count += 1;
        if self.signal_shutdown_on_sleep {
            if let Some(shutdown) = &self.shutdown {
                shutdown.store(true, Ordering::Release);
            }
        }
    }

    fn shutdown_requested(&self) -> bool {
        self.shutdown
            .as_ref()
            .is_some_and(|shutdown| shutdown.load(Ordering::Acquire))
    }

    fn settle_trial(&mut self, succeeded: bool) -> Result<(), String> {
        self.settled.push(succeeded);
        Ok(())
    }

    fn select_application(&mut self, _current: &ApiCommand) -> Result<ApiCommand, String> {
        self.selected_command
            .clone()
            .ok_or_else(|| "test fallback command missing".into())
    }

    fn prepare_application(&mut self, command: &ApiCommand) -> Result<(), String> {
        self.prepared_commands.push(command.clone());
        Ok(())
    }
}

fn script(exit: i32, output: &str) -> Script {
    Script {
        exit: Some(exit),
        launch_error: None,
        output: output.into(),
        readiness: VecDeque::new(),
    }
}

fn command(dir: &TempDir) -> ApiCommand {
    let mut command = ApiCommand::new("unused-in-fake", ".", &dir.0, 4420);
    command.build_tag = "build-1".into();
    command.poll_interval = Duration::ZERO;
    command
}

#[test]
fn code_75_reloads_node_config_before_the_next_launch() {
    let dir = TempDir::new();
    let mut backend = FakeBackend::default();
    backend.node_configs = VecDeque::from([
        LanNodeConfig {
            mode: "host".into(),
            port: Some(4443),
        },
        LanNodeConfig::default(),
    ]);
    backend.scripts = VecDeque::from([script(75, ""), script(2, "")]);
    let result = supervise_api(&mut backend, command(&dir)).unwrap();
    assert_eq!(backend.launched_modes, ["server", "local"]);
    assert_eq!(backend.sleep_count, 1);
    assert_eq!(
        result,
        SupervisorOutcome::Exited {
            code: 2,
            payload_trial_rolled_back: false
        }
    );
}

#[test]
fn first_lan_host_failure_retries_local_once_and_preserves_safe_reason() {
    let dir = TempDir::new();
    let mut backend = FakeBackend::default();
    backend.node_configs = VecDeque::from([
        LanNodeConfig {
            mode: "host".into(),
            port: None,
        },
        LanNodeConfig {
            mode: "host".into(),
            port: None,
        },
    ]);
    backend.scripts = VecDeque::from([
        script(1, "Error: EADDRINUSE: LAN port occupied\n"),
        script(3, ""),
    ]);
    let result = supervise_api(&mut backend, command(&dir)).unwrap();
    assert_eq!(backend.launched_modes, ["server", "local"]);
    assert_eq!(backend.sleep_count, 1);
    assert_eq!(
        result,
        SupervisorOutcome::Exited {
            code: 3,
            payload_trial_rolled_back: false
        }
    );
}

#[test]
fn trial_commits_only_after_backend_reports_both_readiness_checks() {
    let dir = TempDir::new();
    let mut backend = FakeBackend::default();
    backend.scripts = VecDeque::from([Script {
        exit: Some(2),
        launch_error: None,
        output: String::new(),
        readiness: VecDeque::from([true]),
    }]);
    let mut command = command(&dir);
    command.trial = true;
    let result = supervise_api(&mut backend, command).unwrap();
    assert_eq!(backend.settled, [true]);
    assert!(backend.selected_command.is_none());
    assert_eq!(
        result,
        SupervisorOutcome::Exited {
            code: 2,
            payload_trial_rolled_back: false
        }
    );
}

#[test]
fn trial_timeout_kills_and_waits_then_selects_previous_application() {
    let dir = TempDir::new();
    let mut backend = FakeBackend::default();
    backend.scripts = VecDeque::from([script(1, ""), script(2, "")]);
    let mut baseline = command(&dir);
    baseline.program = dir.0.join("baseline-api.exe");
    baseline.cwd = dir.0.join("baseline-working-dir");
    baseline.web_dist = Some(dir.0.join("baseline-web"));
    baseline.build_tag = "baseline-build".into();
    baseline
        .base_env
        .insert("BASELINE_ONLY".into(), "yes".into());
    backend.selected_command = Some(baseline.clone());
    let mut command = command(&dir);
    command.trial = true;
    command.trial_timeout = Duration::ZERO;
    let result = supervise_api(&mut backend, command).unwrap();
    assert_eq!(backend.kill_count, 1);
    assert_eq!(backend.settled, [false]);
    assert_eq!(backend.launched_commands[1].program, baseline.program);
    assert_eq!(backend.launched_commands[1].cwd, baseline.cwd);
    assert_eq!(backend.launched_commands[1].web_dist, baseline.web_dist);
    assert_eq!(backend.launched_commands[1].build_tag, "baseline-build");
    assert_eq!(backend.launched_commands[1].base_env, baseline.base_env);
    assert!(!backend.launched_commands[1].trial);
    assert_eq!(backend.prepared_commands.len(), 1);
    assert_eq!(backend.prepared_commands[0].program, baseline.program);
    assert_eq!(backend.prepared_commands[0].cwd, baseline.cwd);
    assert_eq!(backend.launched_modes, ["local", "local"]);
    assert_eq!(
        result,
        SupervisorOutcome::Exited {
            code: 2,
            payload_trial_rolled_back: true
        }
    );
}

#[test]
fn failed_host_spawn_fails_over_to_local_once() {
    let dir = TempDir::new();
    let mut backend = FakeBackend::default();
    backend.node_configs = VecDeque::from([
        LanNodeConfig {
            mode: "host".into(),
            port: None,
        },
        LanNodeConfig {
            mode: "host".into(),
            port: None,
        },
    ]);
    let mut failed = script(1, "");
    failed.launch_error = Some("bind EACCES".into());
    backend.scripts = VecDeque::from([
        failed,
        Script {
            launch_error: Some("local start failed".into()),
            ..script(1, "")
        },
    ]);
    let error = supervise_api(&mut backend, command(&dir)).unwrap_err();
    assert_eq!(backend.launched_modes, ["server", "local"]);
    assert!(error.contains("local start failed"));
}

#[cfg(windows)]
fn system_request_at(dir: &TempDir, child_mode: &str, api_port: u16) -> ApiLaunchRequest {
    let mut command = ApiCommand::new(
        std::env::current_exe().unwrap(),
        std::env::current_dir().unwrap(),
        &dir.0,
        api_port,
    );
    command.args = vec![
        "--exact".into(),
        "synthetic_child_entrypoint".into(),
        "--nocapture".into(),
    ];
    command.base_env = BTreeMap::from([
        (
            OsString::from("ORION_TEST_CHILD_MODE"),
            OsString::from(child_mode),
        ),
        (
            OsString::from("ORION_TEST_INHERITED_OVERRIDE"),
            OsString::from("base-value"),
        ),
        (
            OsString::from("ORION_MODE"),
            OsString::from("stale-parent-mode"),
        ),
        (
            OsString::from("orion_mode"),
            OsString::from("duplicate-case-value"),
        ),
    ]);
    command.build_tag = "build-child".into();
    let mode = api_mode(&LanNodeConfig::default(), false, None, "orion-host", None);
    ApiLaunchRequest {
        mode,
        expected_build_tag: "build-child".into(),
        ack_file: None,
        api_port: command.api_port,
        command,
    }
}

#[cfg(windows)]
fn system_request(dir: &TempDir, child_mode: &str) -> ApiLaunchRequest {
    system_request_at(dir, child_mode, 4420)
}

#[cfg(windows)]
#[test]
fn synthetic_child_entrypoint() {
    let Some(mode) = std::env::var_os("ORION_TEST_CHILD_MODE") else {
        return;
    };
    println!("stdout-proof");
    eprintln!("stderr-proof");
    println!("mode={}", std::env::var("ORION_MODE").unwrap_or_default());
    println!(
        "inherited-override={}",
        std::env::var("ORION_TEST_INHERITED_OVERRIDE").unwrap_or_default()
    );
    println!(
        "parent-inherited={}",
        std::env::var("ORION_TEST_PARENT_INHERITED").unwrap_or_default()
    );
    match mode.to_string_lossy().as_ref() {
        "sleep" => std::thread::sleep(Duration::from_secs(30)),
        "flood" => println!("{}", "x".repeat(30_000)),
        "health-server" => synthetic_health_server(),
        _ => {}
    }
}

#[cfg(windows)]
fn synthetic_health_server() {
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpListener};
    let port = std::env::var("PORT").unwrap().parse::<u16>().unwrap();
    if let (Ok(ack), Some(path)) = (
        std::env::var("ORION_TEST_ACK_VALUE"),
        std::env::var_os("ORION_PAYLOAD_ACK_FILE"),
    ) {
        let _ = std::fs::write(path, ack);
    }
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
    for mut stream in listener.incoming().flatten() {
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request);
        let body = r#"{"database":"ok"}"#;
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
    }
}

#[cfg(windows)]
#[test]
fn system_backend_uses_api_job_drains_both_streams_and_applies_case_insensitive_env_override() {
    let dir = TempDir::new();
    std::env::set_var("ORION_TEST_PARENT_INHERITED", "preserved-parent-value");
    let mut backend = SystemApiBackend::new(dir.0.join("lan-node.json"));
    let request = system_request(&dir, "exit");
    let mut process = backend.launch(&request).expect("API starts inside its Job");
    std::env::remove_var("ORION_TEST_PARENT_INHERITED");
    assert!(process.belongs_to_api_job().unwrap());
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if backend.try_wait(&mut process).unwrap().is_some() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "synthetic child did not exit"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = backend.captured_output(&mut process);
    assert!(output.contains("stdout-proof"));
    assert!(output.contains("stderr-proof"));
    assert!(output.contains("mode=local"));
    assert!(output.contains("inherited-override=base-value"));
    assert!(output.contains("parent-inherited=preserved-parent-value"));
}

#[cfg(windows)]
#[test]
fn system_backend_bounds_output_and_api_job_cleanup_is_scoped() {
    let dir = TempDir::new();
    let mut backend = SystemApiBackend::new(dir.0.join("lan-node.json"));
    let request = system_request(&dir, "flood");
    let mut process = backend
        .launch(&request)
        .expect("flooding child starts in API Job");
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if backend.try_wait(&mut process).unwrap().is_some() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "flood child did not exit"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = backend.captured_output(&mut process);
    assert!(output.len() <= 20_000);

    let mut api_process = backend.launch(&system_request(&dir, "sleep")).unwrap();
    let mut sibling_job = supervisor::Supervisor::new().unwrap();
    let nul = std::fs::File::open("NUL").unwrap();
    use std::os::windows::io::AsRawHandle;
    let sibling_spec = supervisor::ProcessSpec::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("synthetic_child_entrypoint")
        .arg("--nocapture")
        .env_inherited("ORION_TEST_CHILD_MODE", "sleep")
        .stdio_handles(
            nul.as_raw_handle() as usize,
            nul.as_raw_handle() as usize,
            nul.as_raw_handle() as usize,
        );
    let sibling_pid = sibling_job.spawn(sibling_spec).unwrap();
    assert!(api_process.belongs_to_api_job().unwrap());
    backend.kill_and_wait(&mut api_process).unwrap();
    assert_eq!(
        api_process.wait_for_exit(Duration::from_secs(1)).unwrap(),
        Some(1)
    );
    assert_eq!(
        sibling_job
            .wait_for_exit(sibling_pid, Duration::ZERO)
            .unwrap(),
        None
    );
    sibling_job.terminate_all().unwrap();
}

#[cfg(windows)]
#[test]
fn failed_api_spawn_closes_job_and_pipe_handles_without_uncontained_fallback() {
    let dir = TempDir::new();
    let mut backend = SystemApiBackend::new(dir.0.join("lan-node.json"));
    let mut request = system_request(&dir, "exit");
    request.command.program = dir.0.join("missing-api-child.exe");
    let error = match backend.launch(&request) {
        Ok(_) => panic!("missing executable must fail closed"),
        Err(error) => error,
    };
    assert!(error.contains("start API in Job"));
}

#[cfg(windows)]
fn free_loopback_port() -> u16 {
    std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[cfg(windows)]
#[test]
fn system_trial_requires_matching_ack_and_listener_from_exact_api_job() {
    use rust_api_supervisor::ApiSupervisorBackend as _;
    let dir = TempDir::new();
    let port = free_loopback_port();
    let mut request = system_request_at(&dir, "health-server", port);
    let ack = dir.0.join("valid-ack");
    std::fs::write(&ack, "").unwrap();
    request.ack_file = Some(ack.clone());
    request.command.trial = true;
    let mut backend = SystemApiBackend::new(dir.0.join("lan-node.json"));
    let mut process = backend.launch(&request).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).is_ok() {
        assert!(
            std::time::Instant::now() < deadline,
            "API listener did not start"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!backend.trial_readiness(&mut process, &request).unwrap());
    std::fs::write(&ack, "build-child").unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if backend.trial_readiness(&mut process, &request).unwrap() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "owned listener with matching ACK never became ready"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    backend.kill_and_wait(&mut process).unwrap();
}

#[cfg(windows)]
#[test]
fn system_trial_rejects_foreign_listener_even_with_matching_spoofed_ack() {
    let dir = TempDir::new();
    let port = free_loopback_port();
    let mut request = system_request_at(&dir, "sleep", port);
    let ack = dir.0.join("spoofed-ack");
    std::fs::write(&ack, "build-child").unwrap();
    request.ack_file = Some(ack);
    request.command.trial = true;
    let mut backend = SystemApiBackend::new(dir.0.join("lan-node.json"));
    let mut api_process = backend.launch(&request).unwrap();

    let foreign = system_request_at(&dir, "health-server", port);
    let mut foreign_process = backend.launch(&foreign).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).is_ok() {
        assert!(
            std::time::Instant::now() < deadline,
            "foreign listener did not start"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!backend.trial_readiness(&mut api_process, &request).unwrap());
    backend.kill_and_wait(&mut api_process).unwrap();
    backend.kill_and_wait(&mut foreign_process).unwrap();
}

#[test]
fn system_payload_callbacks_fail_closed_until_product_state_is_wired() {
    use rust_api_supervisor::ApiSupervisorBackend as _;
    let mut backend = SystemApiBackend::new("lan-node.json");
    let command = ApiCommand::new("api.exe", ".", ".", 4420);
    assert!(backend.settle_trial(true).is_err());
    assert!(backend.select_application(&command).is_err());
}

#[test]
fn shared_shutdown_signal_stops_running_api_and_returns_success_outcome() {
    let dir = TempDir::new();
    let shutdown = Arc::new(AtomicBool::new(false));
    let mut backend = FakeBackend {
        scripts: VecDeque::from([Script {
            exit: None,
            launch_error: None,
            output: String::new(),
            readiness: VecDeque::new(),
        }]),
        shutdown: Some(Arc::clone(&shutdown)),
        signal_shutdown_on_sleep: true,
        ..FakeBackend::default()
    };

    let result = supervise_api(&mut backend, command(&dir)).unwrap();
    assert!(shutdown.load(Ordering::Acquire));
    assert_eq!(backend.launched_commands.len(), 1);
    assert_eq!(backend.kill_count, 1);
    assert_eq!(result, SupervisorOutcome::Shutdown);
}

#[test]
fn shutdown_during_unready_trial_marks_it_failed_without_restarting_api() {
    let dir = TempDir::new();
    let shutdown = Arc::new(AtomicBool::new(false));
    let mut backend = FakeBackend {
        scripts: VecDeque::from([Script {
            exit: None,
            launch_error: None,
            output: String::new(),
            readiness: VecDeque::new(),
        }]),
        shutdown: Some(Arc::clone(&shutdown)),
        signal_shutdown_on_sleep: true,
        ..FakeBackend::default()
    };
    let mut command = command(&dir);
    command.trial = true;

    let result = supervise_api(&mut backend, command).unwrap();
    assert_eq!(backend.kill_count, 1);
    assert_eq!(backend.settled, [false]);
    assert_eq!(backend.launched_commands.len(), 1);
    assert_eq!(result, SupervisorOutcome::Shutdown);
}

#[test]
fn secret_redaction_handles_a_value_split_between_pipe_reads() {
    use rust_api_supervisor::redact_complete_prefix;
    let secret = b"admin-secret-value".to_vec();
    let mut pending = b"prefix admin-sec".to_vec();
    let first = redact_complete_prefix(&mut pending, &[secret.clone()]);
    assert_eq!(first, b"prefix ");
    pending.extend_from_slice(b"ret-value suffix");
    let second = redact_complete_prefix(&mut pending, &[secret]);
    let mut result = first;
    result.extend(second);
    result.extend(pending);
    assert_eq!(result, b"prefix [REDACTED] suffix");
}
