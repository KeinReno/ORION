//! Standalone, opt-in API process supervisor modeled on launcher.cjs.
//!
//! It owns one API child, drains both output streams, probes trial readiness, and
//! applies launcher restart/failover decisions. It is intentionally not wired into
//! the packaged product path. The backend trait keeps process and clock behavior
//! injectable for deterministic contract tests.

use crate::rust_api::{
    api_exit_decision, api_mode, failure_reason, ApiMode, ExitDecision, HealthEvidence,
    LanNodeConfig, TrialReadiness, TrialReadinessGate, RESTART_DELAY_MS,
};
use crate::rust_payload_supervisor::PayloadSupervisorAdapter;
#[cfg(windows)]
use crate::supervisor::{ProcessSpec, Supervisor};
use std::collections::BTreeMap;
#[cfg(any(windows, test))]
use std::collections::VecDeque;
use std::ffi::OsString;
#[cfg(windows)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io;
use std::io::Read;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(any(windows, test))]
use std::sync::Mutex;
use std::thread;
#[cfg(windows)]
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[cfg(any(windows, test))]
const OUTPUT_LIMIT: usize = 20_000;

#[derive(Clone, Debug)]
pub struct ApiCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    /// Fully prepared launcher environment before the per-mode overlay.
    pub base_env: BTreeMap<OsString, OsString>,
    pub data_dir: PathBuf,
    pub api_port: u16,
    pub build_tag: String,
    pub web_dist: Option<PathBuf>,
    pub payload_failure: String,
    pub lan_address: Option<String>,
    pub hostname: String,
    pub trial: bool,
    pub trial_timeout: Duration,
    pub poll_interval: Duration,
}

impl ApiCommand {
    pub fn new(
        program: impl Into<PathBuf>,
        cwd: impl Into<PathBuf>,
        data_dir: impl Into<PathBuf>,
        api_port: u16,
    ) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            cwd: cwd.into(),
            base_env: BTreeMap::new(),
            data_dir: data_dir.into(),
            api_port,
            build_tag: String::new(),
            web_dist: None,
            payload_failure: String::new(),
            lan_address: None,
            hostname: "localhost".into(),
            trial: false,
            trial_timeout: crate::timeouts::TRIAL_TIMEOUT,
            poll_interval: crate::timeouts::API_POLL_INTERVAL,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ApiLaunchRequest {
    pub mode: ApiMode,
    pub expected_build_tag: String,
    pub ack_file: Option<PathBuf>,
    pub api_port: u16,
    pub command: ApiCommand,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessExit {
    pub code: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SupervisorOutcome {
    Exited {
        code: i32,
        payload_trial_rolled_back: bool,
    },
    /// The host requested an orderly shutdown. The API process has been
    /// stopped and the caller can now perform database cleanup.
    Shutdown,
}

pub trait ApiSupervisorBackend {
    type Process;

    fn read_node_config(&mut self) -> LanNodeConfig;
    fn launch(&mut self, request: &ApiLaunchRequest) -> Result<Self::Process, String>;
    fn try_wait(&mut self, process: &mut Self::Process) -> Result<Option<ProcessExit>, String>;
    fn trial_readiness(
        &mut self,
        process: &mut Self::Process,
        request: &ApiLaunchRequest,
    ) -> Result<bool, String>;
    fn captured_output(&mut self, process: &mut Self::Process) -> String;
    fn kill_and_wait(&mut self, process: &mut Self::Process) -> Result<(), String>;
    fn sleep(&mut self, duration: Duration);
    /// Shared with the host runtime so shutdown can interrupt a live API wait.
    fn shutdown_requested(&self) -> bool {
        false
    }
    fn settle_trial(&mut self, succeeded: bool) -> Result<(), String>;
    /// Return the complete command for the selected fallback application. This
    /// must include its executable, working directory, assets, and environment.
    fn select_application(&mut self, current: &ApiCommand) -> Result<ApiCommand, String>;
    /// Prepare a newly selected fallback before the supervisor launches it.
    /// The packaged runtime uses this hook to deploy Prisma migrations against
    /// the selected API schema after a failed trial.
    fn prepare_application(&mut self, _command: &ApiCommand) -> Result<(), String> {
        Ok(())
    }
}

/// Runs one API process at a time. Code 75 always clears the prior LAN failure and
/// rereads node configuration on the next pass, matching the launcher branch order.
pub fn supervise_api<B: ApiSupervisorBackend>(
    backend: &mut B,
    mut command: ApiCommand,
) -> Result<SupervisorOutcome, String> {
    let mut host_failed: Option<String> = None;
    let mut any_trial_rolled_back = false;

    loop {
        if backend.shutdown_requested() {
            if command.trial {
                backend.settle_trial(false)?;
            }
            return Ok(SupervisorOutcome::Shutdown);
        }
        let node = backend.read_node_config();
        let mode = api_mode(
            &node,
            host_failed.is_some(),
            command.lan_address.as_deref(),
            &command.hostname,
            host_failed.as_deref(),
        );
        let trial = command.trial;
        let ack_file = if trial {
            Some(make_ack_path(&command.data_dir)?)
        } else {
            None
        };
        let request = ApiLaunchRequest {
            mode: mode.clone(),
            expected_build_tag: command.build_tag.clone(),
            ack_file: ack_file.clone(),
            api_port: command.api_port,
            command: command.clone(),
        };

        let mut process = match backend.launch(&request) {
            Ok(process) => process,
            Err(error) => {
                remove_ack(ack_file.as_deref());
                if trial {
                    backend.settle_trial(false)?;
                    command = backend.select_application(&command)?;
                    command.trial = false;
                    backend.prepare_application(&command)?;
                    any_trial_rolled_back = true;
                    continue;
                }
                if mode.lan_host && host_failed.is_none() {
                    host_failed = Some(failure_reason(&error));
                    backend.sleep(Duration::from_millis(RESTART_DELAY_MS));
                    continue;
                }
                return Err(format!(
                    "Не удалось запустить API: {}",
                    failure_reason(&error)
                ));
            }
        };

        let started = Instant::now();
        let mut trial_ready = false;
        loop {
            if backend.shutdown_requested() {
                let cleanup = backend.kill_and_wait(&mut process);
                remove_ack(ack_file.as_deref());
                cleanup?;
                if trial && !trial_ready {
                    backend.settle_trial(false)?;
                }
                return Ok(SupervisorOutcome::Shutdown);
            }
            if trial && !trial_ready && started.elapsed() >= command.trial_timeout {
                let cleanup = backend.kill_and_wait(&mut process);
                remove_ack(ack_file.as_deref());
                cleanup?;
                backend.settle_trial(false)?;
                command = backend.select_application(&command)?;
                command.trial = false;
                backend.prepare_application(&command)?;
                any_trial_rolled_back = true;
                break;
            }

            if trial && !trial_ready {
                if let Ok(true) = backend.trial_readiness(&mut process, &request) {
                    backend.settle_trial(true)?;
                    command.trial = false;
                    trial_ready = true;
                    remove_ack(ack_file.as_deref());
                }
            }

            let exit = match backend.try_wait(&mut process) {
                Ok(exit) => exit,
                Err(error) => {
                    let cleanup = backend.kill_and_wait(&mut process);
                    remove_ack(ack_file.as_deref());
                    cleanup?;
                    return Err(error);
                }
            };
            match exit {
                Some(exit) => {
                    remove_ack(ack_file.as_deref());
                    if trial && !trial_ready {
                        backend.settle_trial(false)?;
                        command = backend.select_application(&command)?;
                        command.trial = false;
                        backend.prepare_application(&command)?;
                        any_trial_rolled_back = true;
                        break;
                    }
                    match api_exit_decision(
                        exit.code,
                        mode.lan_host,
                        host_failed.is_some(),
                        &backend.captured_output(&mut process),
                    ) {
                        ExitDecision::RestartForNodeMode { delay_ms } => {
                            host_failed = None;
                            backend.sleep(Duration::from_millis(delay_ms));
                            break;
                        }
                        ExitDecision::FailOverToLocal { delay_ms, reason } => {
                            host_failed = Some(reason);
                            backend.sleep(Duration::from_millis(delay_ms));
                            break;
                        }
                        ExitDecision::Exit { exit_code } => {
                            return Ok(SupervisorOutcome::Exited {
                                code: exit_code,
                                payload_trial_rolled_back: any_trial_rolled_back,
                            });
                        }
                    }
                }
                None => backend.sleep(command.poll_interval),
            }
        }
    }
}

fn make_ack_path(data_dir: &Path) -> Result<PathBuf, String> {
    if !data_dir.is_absolute() {
        return Err("UI ACK data directory must be absolute".into());
    }
    ensure_no_reparse_directory(data_dir)?;
    let dir = data_dir.join("app-updates");
    match fs::symlink_metadata(&dir) {
        Ok(metadata) if !metadata.is_dir() || is_reparse_point(&metadata) => {
            return Err("UI ACK directory is not a plain directory".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(&dir).map_err(|e| format!("create UI ACK directory: {e}"))?;
        }
        Err(error) => return Err(format!("inspect UI ACK directory: {error}")),
    }
    ensure_no_reparse_directory(&dir)?;
    let mut nonce = [0_u8; 16];
    getrandom::getrandom(&mut nonce)
        .map_err(|_| "secure random source unavailable for UI ACK name")?;
    let path = dir.join(format!("ui-ready-{}", hex(&nonce)));
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("create unique UI ACK file: {e}"))?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| format!("inspect UI ACK file: {e}"))?;
    if !metadata.is_file() || is_reparse_point(&metadata) {
        let _ = fs::remove_file(&path);
        return Err("UI ACK path is not a plain file".into());
    }
    Ok(path)
}

fn ensure_no_reparse_directory(path: &Path) -> Result<(), String> {
    let ancestors: Vec<_> = path.ancestors().collect();
    for ancestor in ancestors.into_iter().rev() {
        let metadata = fs::symlink_metadata(ancestor)
            .map_err(|e| format!("inspect runtime directory: {e}"))?;
        if !metadata.is_dir() || is_reparse_point(&metadata) {
            return Err("runtime directory contains a reparse point or non-directory".into());
        }
    }
    Ok(())
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize] as char);
        result.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    result
}

fn remove_ack(path: Option<&Path>) {
    if let Some(path) = path {
        let _ = fs::remove_file(path);
    }
}

type PrepareHook = Box<dyn FnMut(&ApiCommand) -> Result<(), String> + Send>;

/// Each API attempt gets a dedicated kill-on-close Job. Killing an API restart
/// therefore leaves PostgreSQL in the launcher's separate outer Job untouched.
pub struct SystemApiBackend {
    pub lan_node_file: PathBuf,
    shutdown: Arc<AtomicBool>,
    payload: Option<PayloadSupervisorAdapter>,
    prepare: Option<PrepareHook>,
}

impl SystemApiBackend {
    pub fn new(lan_node_file: impl Into<PathBuf>) -> Self {
        Self {
            lan_node_file: lan_node_file.into(),
            shutdown: Arc::new(AtomicBool::new(false)),
            payload: None,
            prepare: None,
        }
    }

    /// Use the payload selector already primed by lifecycle startup. Retaining
    /// that adapter is required so trial ACK and rollback transitions update
    /// the same persisted state selected before database migrations.
    pub fn with_payload_adapter(mut self, payload: PayloadSupervisorAdapter) -> Self {
        self.payload = Some(payload);
        self
    }

    /// Share the host's shutdown signal. The caller owns the `Arc` and can set
    /// it from its stdin monitor or desktop shutdown controller.
    pub fn with_shutdown_flag(mut self, shutdown: Arc<AtomicBool>) -> Self {
        self.shutdown = shutdown;
        self
    }

    pub fn with_prepare_application<F>(mut self, prepare: F) -> Self
    where
        F: FnMut(&ApiCommand) -> Result<(), String> + Send + 'static,
    {
        self.prepare = Some(Box::new(prepare));
        self
    }

    pub fn shutdown_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.shutdown)
    }
}

#[cfg(windows)]
pub struct SystemApiProcess {
    supervisor: Supervisor,
    pid: u32,
    output: Arc<Mutex<VecDeque<u8>>>,
    stop_readers: Arc<AtomicBool>,
    reader_failed: Arc<AtomicBool>,
    readers: Vec<JoinHandle<()>>,
    api_port: u16,
    ack_file: Option<PathBuf>,
    started_at: Instant,
    listening_reported: bool,
    finished: bool,
    exit: Option<ProcessExit>,
}

#[cfg(not(windows))]
pub struct SystemApiProcess;

impl ApiSupervisorBackend for SystemApiBackend {
    type Process = SystemApiProcess;

    fn read_node_config(&mut self) -> LanNodeConfig {
        fs::read_to_string(&self.lan_node_file)
            .ok()
            .as_deref()
            .map(|raw| LanNodeConfig::parse_or_local(Some(raw)))
            .unwrap_or_default()
    }

    fn launch(&mut self, request: &ApiLaunchRequest) -> Result<Self::Process, String> {
        #[cfg(windows)]
        {
            self.launch_in_job(request)
        }
        #[cfg(not(windows))]
        {
            let _ = request;
            Err("API process supervision requires Windows Job Objects".into())
        }
    }

    fn try_wait(&mut self, process: &mut Self::Process) -> Result<Option<ProcessExit>, String> {
        #[cfg(windows)]
        {
            if process.reader_failed.load(Ordering::SeqCst) {
                return Err("API output pipe reader failed".into());
            }
            if !process.listening_reported {
                let output = process.output.lock().expect("output lock");
                const LISTENING: &[u8] = b" listening on http://";
                if output
                    .iter()
                    .copied()
                    .collect::<Vec<_>>()
                    .windows(LISTENING.len())
                    .any(|window| window == LISTENING)
                {
                    process.listening_reported = true;
                    eprintln!(
                        "[orion-runtime] startup-stage=api-listening elapsed-ms={}",
                        process.started_at.elapsed().as_millis()
                    );
                }
            }
            if let Some(exit) = process.exit {
                return Ok(Some(exit));
            }
            match process
                .supervisor
                .wait_for_exit(process.pid, Duration::ZERO)
                .map_err(|e| format!("wait API: {e}"))?
            {
                Some(code) => {
                    let cleanup = process.supervisor.terminate_all();
                    process.finish_readers(cleanup.is_err());
                    cleanup.map_err(|e| format!("close API Job after exit: {e}"))?;
                    let exit = ProcessExit {
                        code: Some(code as i32),
                    };
                    process.exit = Some(exit);
                    process.finished = true;
                    Ok(Some(exit))
                }
                None => Ok(None),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = process;
            Err("API process supervision requires Windows Job Objects".into())
        }
    }

    fn trial_readiness(
        &mut self,
        process: &mut Self::Process,
        request: &ApiLaunchRequest,
    ) -> Result<bool, String> {
        #[cfg(windows)]
        {
            let ack = process.ack_file.as_deref().is_some_and(|path| {
                fs::read_to_string(path)
                    .map(|tag| tag == request.expected_build_tag)
                    .unwrap_or(false)
            });
            if !ack {
                return Ok(false);
            }
            if !api_listener_owned_by_job(process, request.api_port)? {
                return Ok(false);
            }
            let Some(health) =
                local_health(process.api_port, crate::timeouts::API_HEALTH_PROBE_TIMEOUT)
            else {
                return Ok(false);
            };
            // Refuse a listener swap between the ownership check and HTTP probe.
            if !api_listener_owned_by_job(process, request.api_port)? {
                return Ok(false);
            }
            let mut gate = TrialReadinessGate::new(request.expected_build_tag.clone());
            gate.record_ui_ack(request.expected_build_tag.clone());
            gate.record_health(health);
            Ok(gate.evaluate() == TrialReadiness::CommitPayload)
        }
        #[cfg(not(windows))]
        {
            let _ = (process, request);
            Err("API process supervision requires Windows Job Objects".into())
        }
    }

    fn captured_output(&mut self, process: &mut Self::Process) -> String {
        #[cfg(windows)]
        {
            let bytes: Vec<u8> = process
                .output
                .lock()
                .expect("output lock")
                .iter()
                .copied()
                .collect();
            String::from_utf8_lossy(&bytes).into_owned()
        }
        #[cfg(not(windows))]
        {
            let _ = process;
            String::new()
        }
    }

    fn kill_and_wait(&mut self, process: &mut Self::Process) -> Result<(), String> {
        #[cfg(windows)]
        {
            let result = process.supervisor.terminate_all();
            process.finish_readers(result.is_err());
            process.finished = true;
            result.map_err(|e| format!("terminate API Job: {e}"))
        }
        #[cfg(not(windows))]
        {
            let _ = process;
            Err("API process supervision requires Windows Job Objects".into())
        }
    }

    fn sleep(&mut self, duration: Duration) {
        thread::sleep(duration);
    }

    fn shutdown_requested(&self) -> bool {
        self.shutdown.load(Ordering::Acquire)
    }

    fn settle_trial(&mut self, succeeded: bool) -> Result<(), String> {
        self.payload
            .as_mut()
            .ok_or_else(|| "payload adapter is required to settle a trial".to_owned())?
            .settle_trial(succeeded)
            .map_err(|error| error.to_string())
    }

    fn select_application(&mut self, current: &ApiCommand) -> Result<ApiCommand, String> {
        self.payload
            .as_mut()
            .ok_or_else(|| "payload adapter is required to select an application".to_owned())?
            .select_application(current)
            .map_err(|error| error.to_string())
    }

    fn prepare_application(&mut self, command: &ApiCommand) -> Result<(), String> {
        if let Some(prepare) = self.prepare.as_mut() {
            prepare(command)?;
        }
        Ok(())
    }
}

#[cfg(windows)]
fn api_listener_owned_by_job(process: &SystemApiProcess, port: u16) -> Result<bool, String> {
    use std::ffi::c_void;

    #[repr(C)]
    struct TcpRowOwnerPid {
        state: u32,
        local_addr: u32,
        local_port: u32,
        remote_addr: u32,
        remote_port: u32,
        owning_pid: u32,
    }

    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetExtendedTcpTable(
            table: *mut c_void,
            size: *mut u32,
            order: i32,
            address_family: u32,
            table_class: u32,
            reserved: u32,
        ) -> u32;
    }

    const AF_INET: u32 = 2;
    const TCP_TABLE_OWNER_PID_LISTENER: u32 = 3;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    let mut size = 0;
    let first = unsafe {
        GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size,
            0,
            AF_INET,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if first != ERROR_INSUFFICIENT_BUFFER || size < std::mem::size_of::<u32>() as u32 {
        return Err(format!("query API listener table size failed: {first}"));
    }
    let mut storage = vec![0_u64; (size as usize).div_ceil(8)];
    let result = unsafe {
        GetExtendedTcpTable(
            storage.as_mut_ptr().cast(),
            &mut size,
            0,
            AF_INET,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if result != 0 {
        return Err(format!("query API listener table failed: {result}"));
    }
    let count = unsafe { *(storage.as_ptr().cast::<u32>()) } as usize;
    let row_size = std::mem::size_of::<TcpRowOwnerPid>();
    let rows_start = unsafe {
        storage
            .as_ptr()
            .cast::<u8>()
            .add(std::mem::size_of::<u32>())
    };
    if count > (size as usize).saturating_sub(4) / row_size {
        return Err("API listener table has an invalid row count".into());
    }
    for index in 0..count {
        let row = unsafe { &*rows_start.add(index * row_size).cast::<TcpRowOwnerPid>() };
        if u16::from_be(row.local_port as u16) == port
            && process
                .supervisor
                .owns_pid(row.owning_pid)
                .map_err(|e| format!("query API listener Job membership: {e}"))?
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(windows)]
impl SystemApiBackend {
    fn launch_in_job(&mut self, request: &ApiLaunchRequest) -> Result<SystemApiProcess, String> {
        let (stdout_reader, stdout_writer) =
            anonymous_pipe().map_err(|e| format!("create API stdout pipe: {e}"))?;
        let (stderr_reader, stderr_writer) =
            anonymous_pipe().map_err(|e| format!("create API stderr pipe: {e}"))?;
        let stdin = File::open("NUL").map_err(|e| format!("open API stdin: {e}"))?;
        let mut spec = ProcessSpec::new(request.command.program.clone())
            .current_dir(request.command.cwd.clone())
            .stdio_handles(
                stdin.as_raw_handle() as usize,
                stdout_writer.as_raw_handle() as usize,
                stderr_writer.as_raw_handle() as usize,
            );

        // Mirror launcher.cjs: inherit the caller environment, apply the prepared
        // base values, then overlay build, trial, and per-attempt node-mode values.
        let mut overrides = BTreeMap::new();
        for (name, value) in &request.command.base_env {
            insert_env(&mut overrides, name.clone(), value.clone());
        }
        insert_env(&mut overrides, "ORION_MODE", request.mode.mode);
        insert_env(&mut overrides, "HOST", request.mode.host);
        insert_env(&mut overrides, "PORT", request.api_port.to_string());
        insert_env(
            &mut overrides,
            "ORION_BUILD_TAG",
            request.expected_build_tag.clone(),
        );
        insert_env(
            &mut overrides,
            "ORION_PAYLOAD_FAILURE",
            request.command.payload_failure.clone(),
        );
        if let Some(web_dist) = &request.command.web_dist {
            insert_env(
                &mut overrides,
                "ORION_WEB_DIST",
                web_dist.as_os_str().to_owned(),
            );
        }
        if request.mode.lan_host {
            insert_env(&mut overrides, "ORION_LAN_HOST", "1");
        }
        if let Some(url) = &request.mode.public_api_url {
            insert_env(&mut overrides, "PUBLIC_API_URL", url.clone());
        }
        if let Some(origins) = request.mode.web_origins {
            insert_env(&mut overrides, "WEB_ORIGINS", origins);
        }
        if let Some(reason) = &request.mode.host_failed_reason {
            insert_env(
                &mut overrides,
                "ORION_LAN_HOST_FAILED",
                format!("«Хост LAN» не запустился: {reason}"),
            );
        }
        if let Some(ack) = &request.ack_file {
            insert_env(
                &mut overrides,
                "ORION_PAYLOAD_ACK_FILE",
                ack.as_os_str().to_owned(),
            );
        }
        for (name, value) in overrides {
            spec = spec.env_inherited(name, value);
        }
        for arg in &request.command.args {
            spec = spec.arg(arg.clone());
        }

        // Supervisor::spawn creates the process suspended, assigns it to this
        // dedicated kill-on-close Job, then resumes it. Any failure closes pipes
        // and the unstarted/failed Job without ever using an uncontained fallback.
        let mut supervisor = Supervisor::new().map_err(|e| format!("create API Job: {e}"))?;
        let pid = supervisor
            .spawn(spec)
            .map_err(|e| format!("start API in Job: {e}"))?;
        drop(stdout_writer);
        drop(stderr_writer);
        drop(stdin);

        let output = Arc::new(Mutex::new(VecDeque::with_capacity(OUTPUT_LIMIT)));
        let stop_readers = Arc::new(AtomicBool::new(false));
        let reader_failed = Arc::new(AtomicBool::new(false));
        let redact_values = request
            .command
            .base_env
            .iter()
            .filter(|(name, _)| is_sensitive_env_name(&name.to_string_lossy()))
            .map(|(_, value)| value.to_string_lossy().as_bytes().to_vec())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        let stdout_thread = match spawn_pipe_reader(
            stdout_reader,
            Arc::clone(&output),
            Arc::clone(&stop_readers),
            Arc::clone(&reader_failed),
            OutputStream::Stdout,
            redact_values.clone(),
        ) {
            Ok(thread) => thread,
            Err(error) => {
                let _ = supervisor.terminate_all();
                return Err(format!("start API stdout drain: {error}"));
            }
        };
        let stderr_thread = match spawn_pipe_reader(
            stderr_reader,
            Arc::clone(&output),
            Arc::clone(&stop_readers),
            Arc::clone(&reader_failed),
            OutputStream::Stderr,
            redact_values,
        ) {
            Ok(thread) => thread,
            Err(error) => {
                stop_readers.store(true, Ordering::SeqCst);
                let _ = supervisor.terminate_all();
                let _ = stdout_thread.join();
                return Err(format!("start API stderr drain: {error}"));
            }
        };
        let readers = vec![stdout_thread, stderr_thread];
        Ok(SystemApiProcess {
            supervisor,
            pid,
            output,
            stop_readers,
            reader_failed,
            readers,
            api_port: request.api_port,
            ack_file: request.ack_file.clone(),
            started_at: Instant::now(),
            listening_reported: false,
            finished: false,
            exit: None,
        })
    }
}

#[cfg(windows)]
fn insert_env(
    values: &mut BTreeMap<OsString, OsString>,
    name: impl Into<OsString>,
    value: impl Into<OsString>,
) {
    let name = name.into();
    let folded = name.to_string_lossy().to_lowercase();
    if let Some(previous) = values
        .keys()
        .find(|existing| existing.to_string_lossy().to_lowercase() == folded)
        .cloned()
    {
        values.remove(&previous);
    }
    values.insert(name, value.into());
}

#[cfg(windows)]
impl SystemApiProcess {
    pub fn belongs_to_api_job(&self) -> Result<bool, String> {
        self.supervisor
            .owns_pid(self.pid)
            .map_err(|e| format!("query API Job membership: {e}"))
    }

    pub fn wait_for_exit(&self, timeout: Duration) -> Result<Option<u32>, String> {
        self.supervisor
            .wait_for_exit(self.pid, timeout)
            .map_err(|e| format!("wait API Job process: {e}"))
    }

    fn finish_readers(&mut self, request_stop: bool) {
        if request_stop {
            self.stop_readers.store(true, Ordering::SeqCst);
        }
        for reader in self.readers.drain(..) {
            let _ = reader.join();
        }
    }
}

#[cfg(windows)]
impl Drop for SystemApiProcess {
    fn drop(&mut self) {
        if !self.finished {
            let stopped = self.supervisor.terminate_all().is_ok();
            self.finish_readers(!stopped);
        }
    }
}

#[cfg(windows)]
fn spawn_pipe_reader(
    mut reader: File,
    output: Arc<Mutex<VecDeque<u8>>>,
    stop: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
    stream: OutputStream,
    redactions: Vec<Vec<u8>>,
) -> io::Result<JoinHandle<()>> {
    thread::Builder::new()
        .name("orion-api-output".into())
        .spawn(move || {
            let mut buffer = [0_u8; 4096];
            let mut pending = Vec::new();
            loop {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                let available = match pipe_available(reader.as_raw_handle()) {
                    Ok(Some(available)) => available,
                    Ok(None) => break,
                    Err(_) => {
                        failed.store(true, Ordering::SeqCst);
                        break;
                    }
                };
                if available == 0 {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                let requested = available.min(buffer.len() as u32) as usize;
                match reader.read(&mut buffer[..requested]) {
                    Ok(0) => break,
                    Err(_) => {
                        failed.store(true, Ordering::SeqCst);
                        break;
                    }
                    Ok(count) => {
                        pending.extend_from_slice(&buffer[..count]);
                        let safe = redact_complete_prefix(&mut pending, &redactions);
                        publish_api_output(&output, stream, &safe);
                    }
                }
            }
            let tail = if !pending.is_empty() {
                let mut tail = redact_complete_prefix(&mut pending, &redactions);
                tail.extend_from_slice(&pending);
                tail
            } else {
                Vec::new()
            };
            publish_api_output(&output, stream, &tail);
        })
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy)]
enum OutputStream {
    Stdout,
    Stderr,
}

#[cfg(any(windows, test))]
fn publish_api_output(output: &Arc<Mutex<VecDeque<u8>>>, stream: OutputStream, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    if let Ok(mut tail) = output.lock() {
        for byte in bytes {
            if tail.len() == OUTPUT_LIMIT {
                tail.pop_front();
            }
            tail.push_back(*byte);
        }
    }
    match stream {
        OutputStream::Stdout => {
            let mut sink = io::stdout().lock();
            let _ = sink.write_all(bytes);
            let _ = sink.flush();
        }
        OutputStream::Stderr => {
            let mut sink = io::stderr().lock();
            let _ = sink.write_all(bytes);
            let _ = sink.flush();
        }
    }
}

fn is_sensitive_env_name(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    [
        "SECRET",
        "PASSWORD",
        "TOKEN",
        "CREDENTIAL",
        "PRIVATE_KEY",
        "DATABASE_URL",
        "AUTH",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

/// Emit bytes as soon as they cannot be the prefix of an environment secret
/// split across reads. Only a potential secret prefix is held between reads.
pub(crate) fn redact_complete_prefix(pending: &mut Vec<u8>, redactions: &[Vec<u8>]) -> Vec<u8> {
    let mut output = Vec::new();
    let mut offset = 0;
    while offset < pending.len() {
        let rest = &pending[offset..];
        if let Some(secret) = redactions
            .iter()
            .filter(|secret| rest.starts_with(secret.as_slice()))
            .max_by_key(|secret| secret.len())
        {
            output.extend_from_slice(b"[REDACTED]");
            offset += secret.len();
            continue;
        }
        if redactions
            .iter()
            .any(|secret| rest.len() < secret.len() && !rest.is_empty() && secret.starts_with(rest))
        {
            break;
        }
        output.push(pending[offset]);
        offset += 1;
    }
    pending.drain(..offset);
    output
}

#[cfg(windows)]
fn anonymous_pipe() -> io::Result<(File, File)> {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreatePipe(
            read_pipe: *mut *mut c_void,
            write_pipe: *mut *mut c_void,
            attrs: *mut c_void,
            size: u32,
        ) -> i32;
        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    const HANDLE_FLAG_INHERIT: u32 = 1;

    let mut read_handle = null_mut();
    let mut write_handle = null_mut();
    if unsafe { CreatePipe(&mut read_handle, &mut write_handle, null_mut(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { SetHandleInformation(read_handle, HANDLE_FLAG_INHERIT, 0) } == 0
        || unsafe { SetHandleInformation(write_handle, HANDLE_FLAG_INHERIT, 0) } == 0
    {
        let error = io::Error::last_os_error();
        unsafe {
            CloseHandle(read_handle);
            CloseHandle(write_handle);
        }
        return Err(error);
    }
    Ok(unsafe {
        (
            File::from_raw_handle(read_handle),
            File::from_raw_handle(write_handle),
        )
    })
}

#[cfg(windows)]
fn pipe_available(handle: RawHandle) -> io::Result<Option<u32>> {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    #[link(name = "kernel32")]
    extern "system" {
        fn PeekNamedPipe(
            pipe: *mut c_void,
            buffer: *mut c_void,
            size: u32,
            read: *mut u32,
            available: *mut u32,
            left: *mut u32,
        ) -> i32;
    }
    let mut available = 0;
    let ok = unsafe {
        PeekNamedPipe(
            handle,
            null_mut(),
            0,
            null_mut(),
            &mut available,
            null_mut(),
        )
    };
    if ok != 0 {
        Ok(Some(available))
    } else {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(109) {
            Ok(None)
        } else {
            Err(error)
        }
    }
}

fn local_health(port: u16, timeout: Duration) -> Option<HealthEvidence> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&address, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    write!(
        stream,
        "GET /system/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let (header_bytes, body_bytes) = split_http_headers(&response)?;
    let headers = String::from_utf8_lossy(header_bytes);
    let status = headers
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse::<u16>()
        .ok()?;
    // Dechunk when the server answers HTTP/1.1 chunked; Nest sends short
    // single-chunk bodies today, but a proxy or a future server version may
    // chunk, and a trial must not hang on a parse failure.
    let decoded;
    let body: &[u8] = if header_value(&headers, "transfer-encoding")
        .is_some_and(|value| value.to_ascii_lowercase().contains("chunked"))
    {
        decoded = dechunk(body_bytes)?;
        &decoded
    } else {
        body_bytes
    };
    let body = std::str::from_utf8(body).ok()?;
    let json: serde_json::Value = serde_json::from_str(body).ok()?;
    Some(HealthEvidence {
        http_ok: (200..300).contains(&status),
        database: json
            .get("database")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
    })
}

/// Locate the end of the HTTP header block. Tolerates both CRLF and bare LF
/// separators so a non-conforming loopback peer cannot break readiness probes.
fn split_http_headers(response: &[u8]) -> Option<(&[u8], &[u8])> {
    if let Some(at) = find_subslice(response, b"\r\n\r\n") {
        return Some((&response[..at], &response[at + 4..]));
    }
    if let Some(at) = find_subslice(response, b"\n\n") {
        return Some((&response[..at], &response[at + 2..]));
    }
    None
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn header_value<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    headers.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

/// Decode an HTTP/1.1 chunked body. Trailers (after the zero-size chunk) are
/// dropped; a truncated chunk sequence is an error, never a partial body.
fn dechunk(mut input: &[u8]) -> Option<Vec<u8>> {
    let mut output = Vec::new();
    loop {
        let line_end = find_subslice(input, b"\n")?;
        let line = input[..line_end]
            .strip_suffix(b"\r")
            .unwrap_or(&input[..line_end]);
        let size_text = line.split(|byte| *byte == b';').next()?;
        let size = usize::from_str_radix(std::str::from_utf8(size_text).ok()?, 16).ok()?;
        input = &input[line_end + 1..];
        if size == 0 {
            return Some(output);
        }
        if input.len() < size {
            return None;
        }
        output.extend_from_slice(&input[..size]);
        input = &input[size..];
        if input.first() == Some(&b'\r') {
            input = &input[1..];
        }
        if input.first() == Some(&b'\n') {
            input = &input[1..];
        } else {
            return None;
        }
    }
}

#[cfg(all(test, windows))]
mod unit_tests {
    use super::*;

    #[test]
    fn output_ring_keeps_only_the_bounded_tail() {
        let output = Arc::new(Mutex::new(VecDeque::with_capacity(OUTPUT_LIMIT)));
        let mut output = output.lock().unwrap();
        for byte in 0..(OUTPUT_LIMIT + 10) {
            if output.len() == OUTPUT_LIMIT {
                output.pop_front();
            }
            output.push_back((byte % 251) as u8);
        }
        assert_eq!(output.len(), OUTPUT_LIMIT);
        assert_eq!(output.front(), Some(&10));
    }

    #[test]
    fn health_parser_accepts_crlf_and_lf_headers() {
        let crlf =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"database\":\"ok\"}";
        let (headers, body) = split_http_headers(crlf).unwrap();
        assert!(String::from_utf8_lossy(headers).starts_with("HTTP/1.1 200"));
        assert_eq!(body, br#"{"database":"ok"}"#);
        let lf = b"HTTP/1.1 200 OK\n\n{\"database\":\"ok\"}";
        let (_, body) = split_http_headers(lf).unwrap();
        assert_eq!(body, br#"{"database":"ok"}"#);
        assert!(split_http_headers(b"HTTP/1.1 200 OK").is_none());
    }

    #[test]
    fn health_parser_reads_chunked_bodies() {
        let chunked = b"1c\r\n{\"database\":\"ok\",\"uptime\":1}\r\n0\r\n\r\n";
        let decoded = dechunk(chunked).unwrap();
        assert_eq!(decoded, br#"{"database":"ok","uptime":1}"#);
        // Chunk extensions after the size are ignored.
        let extended = b"5;foo=bar\r\nhello\r\n0\r\n\r\n";
        assert_eq!(dechunk(extended).unwrap(), b"hello");
        // A truncated chunk is a parse failure, never a partial body.
        assert!(dechunk(b"10\r\nshort").is_none());
        assert!(dechunk(b"").is_none());
    }

    #[test]
    fn header_lookup_is_case_insensitive() {
        let headers =
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: Chunked\r\nContent-Type: application/json";
        assert_eq!(header_value(headers, "transfer-encoding"), Some("Chunked"));
        assert_eq!(header_value(headers, "TRANSFER-ENCODING"), Some("Chunked"));
        assert_eq!(header_value(headers, "content-length"), None);
    }
}
