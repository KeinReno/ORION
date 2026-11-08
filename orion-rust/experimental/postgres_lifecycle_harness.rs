//! Explicitly opt-in, standalone experiment for the bundled Windows PostgreSQL.
//!
//! This file is not included by Cargo or product startup. Compile it directly
//! with `rustc --test` and run only its named test after setting
//! `ORION_RUN_POSTGRES_LIFECYCLE_HARNESS=I_ACCEPT_DISPOSABLE_LOCAL_POSTGRES`.

#[path = "../src/supervisor.rs"]
mod supervisor;

#[cfg(windows)]
mod windows_harness {
    use super::supervisor::{ProcessSpec, Supervisor};
    use std::ffi::OsString;
    use std::fs;
    use std::io;
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    const OPT_IN: &str = "I_ACCEPT_DISPOSABLE_LOCAL_POSTGRES";
    const FORBIDDEN_PORTS: [u16; 3] = [4000, 5433, 55432];
    const CHILD_WAIT: Duration = Duration::from_secs(40);
    const STOP_WAIT: Duration = Duration::from_secs(15);

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn IsProcessInJob(
            process: *mut std::ffi::c_void,
            job: *mut std::ffi::c_void,
            result: *mut i32,
        ) -> i32;
        fn WaitForSingleObject(handle: *mut std::ffi::c_void, milliseconds: u32) -> u32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        fn GetLastError() -> u32;
    }

    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 258;
    const WAIT_FAILED: u32 = 0xFFFF_FFFF;

    struct DisposableProfile {
        root: PathBuf,
        canonical_temp: PathBuf,
        nonce: String,
        remove_on_drop: bool,
    }

    impl DisposableProfile {
        fn create() -> Result<Self, String> {
            let temp = std::env::temp_dir();
            let canonical_temp = fs::canonicalize(&temp)
                .map_err(|error| format!("cannot canonicalize temporary directory: {error}"))?;
            if !canonical_temp.to_string_lossy().is_ascii() {
                return Err("temporary directory is not ASCII; refusing initdb path".into());
            }

            for attempt in 0..8u32 {
                let ticks = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|error| format!("system clock is before UNIX epoch: {error}"))?
                    .as_nanos();
                let nonce = format!("{}-{ticks}-{attempt}", std::process::id());
                let root = temp.join(format!("orion-rust-pg-lifecycle-{nonce}"));
                match fs::create_dir(&root) {
                    Ok(()) => {
                        let root = fs::canonicalize(&root).map_err(|error| {
                            format!("cannot canonicalize disposable root: {error}")
                        })?;
                        if !root.starts_with(&canonical_temp)
                            || !root.to_string_lossy().is_ascii()
                            || !root
                                .file_name()
                                .and_then(|name| name.to_str())
                                .is_some_and(|name| name.starts_with("orion-rust-pg-lifecycle-"))
                        {
                            return Err(
                                "created profile failed its temporary-root safety check".into()
                            );
                        }
                        fs::write(root.join(".orion-harness-owner"), &nonce).map_err(|error| {
                            format!("cannot write one-off profile marker: {error}")
                        })?;
                        fs::create_dir(root.join("cluster")).map_err(|error| {
                            format!("cannot create one-off cluster directory: {error}")
                        })?;
                        fs::create_dir(root.join("tmp")).map_err(|error| {
                            format!("cannot create one-off temp directory: {error}")
                        })?;
                        return Ok(Self {
                            root,
                            canonical_temp,
                            nonce,
                            remove_on_drop: false,
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        return Err(format!("cannot create disposable profile: {error}"));
                    }
                }
            }
            Err("could not allocate a unique disposable profile directory".into())
        }

        fn cluster(&self) -> PathBuf {
            self.root.join("cluster")
        }

        fn pg_log(&self) -> PathBuf {
            self.root.join("postgres.log")
        }

        fn pg_temp(&self) -> PathBuf {
            self.root.join("tmp")
        }

        fn allow_cleanup_after_verified_shutdown(&mut self) -> Result<(), String> {
            let canonical_root = fs::canonicalize(&self.root)
                .map_err(|error| format!("cannot recheck profile root before cleanup: {error}"))?;
            if canonical_root != self.root
                || !canonical_root.starts_with(&self.canonical_temp)
                || !fs::read_to_string(canonical_root.join(".orion-harness-owner"))
                    .is_ok_and(|marker| marker == self.nonce)
            {
                return Err("disposable profile identity changed; leaving it untouched".into());
            }
            self.remove_on_drop = true;
            Ok(())
        }
    }

    impl Drop for DisposableProfile {
        fn drop(&mut self) {
            if self.remove_on_drop {
                // This path is the exact canonical, freshly created child of
                // the system temp directory and is protected by a nonce marker.
                let _ = fs::remove_dir_all(&self.root);
            }
        }
    }

    struct RuntimeBins {
        bin: PathBuf,
        initdb: PathBuf,
        pg_ctl: PathBuf,
    }

    fn find_bundled_bins() -> Result<RuntimeBins, String> {
        let mut current = std::env::current_dir()
            .map_err(|error| format!("cannot read current directory: {error}"))?;
        loop {
            let bin = current.join("apps/desktop/src-tauri/resources/runtime/postgres/bin");
            let initdb = bin.join("initdb.exe");
            let pg_ctl = bin.join("pg_ctl.exe");
            let postgres = bin.join("postgres.exe");
            if initdb.is_file() && pg_ctl.is_file() && postgres.is_file() {
                let bin = fs::canonicalize(bin).map_err(|error| {
                    format!("cannot canonicalize bundled PostgreSQL bin: {error}")
                })?;
                let initdb = fs::canonicalize(initdb)
                    .map_err(|error| format!("cannot canonicalize bundled initdb: {error}"))?;
                let pg_ctl = fs::canonicalize(pg_ctl)
                    .map_err(|error| format!("cannot canonicalize bundled pg_ctl: {error}"))?;
                if !bin.to_string_lossy().is_ascii()
                    || !initdb.starts_with(&bin)
                    || !pg_ctl.starts_with(&bin)
                {
                    return Err("bundled PostgreSQL paths failed ASCII/containment checks".into());
                }
                return Ok(RuntimeBins {
                    bin,
                    initdb,
                    pg_ctl,
                });
            }
            if !current.pop() {
                return Err(
                    "bundled postgres/bin/initdb.exe, pg_ctl.exe, postgres.exe were not found"
                        .into(),
                );
            }
        }
    }

    fn allocate_random_port() -> Result<u16, String> {
        for _ in 0..16 {
            let listener = TcpListener::bind(("127.0.0.1", 0))
                .map_err(|error| format!("cannot reserve an ephemeral loopback port: {error}"))?;
            let port = listener
                .local_addr()
                .map_err(|error| format!("cannot read ephemeral port: {error}"))?
                .port();
            drop(listener);
            if port > 1024 && !FORBIDDEN_PORTS.contains(&port) {
                return Ok(port);
            }
        }
        Err("could not choose a non-reserved ephemeral port".into())
    }

    fn child_spec(program: &Path, bin: &Path, profile: &DisposableProfile) -> ProcessSpec {
        ProcessSpec::new(program)
            .current_dir(bin)
            .isolated_environment()
            .allow_env("SystemRoot")
            .allow_env("WINDIR")
            .allow_env("PATH")
            .env("TEMP", profile.pg_temp().as_os_str())
            .env("TMP", profile.pg_temp().as_os_str())
            .env("PGDATA", profile.cluster().as_os_str())
    }

    fn run_supervised(
        supervisor: &mut Supervisor,
        program: &Path,
        args: &[OsString],
        bins: &RuntimeBins,
        profile: &DisposableProfile,
        timeout: Duration,
    ) -> Result<(u32, u32), String> {
        let mut spec = child_spec(program, &bins.bin, profile);
        for arg in args {
            spec = spec.arg(arg.clone());
        }
        let pid = supervisor
            .spawn(spec)
            .map_err(|error| format!("supervised child start failed: {error}"))?;
        if !is_process_in_job(pid)? {
            return Err(format!(
                "supervised process {pid} was not observed in its Job Object"
            ));
        }
        let code = supervisor
            .wait_for_exit(pid, timeout)
            .map_err(|error| format!("waiting for supervised process {pid} failed: {error}"))?
            .ok_or_else(|| format!("supervised process {pid} exceeded its bounded wait"))?;
        Ok((pid, code))
    }

    fn is_process_in_job(pid: u32) -> Result<bool, String> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            return Err(format!(
                "OpenProcess({pid}) failed with Win32 error {}",
                unsafe { GetLastError() }
            ));
        }
        let mut in_job = 0;
        let checked = unsafe { IsProcessInJob(process, std::ptr::null_mut(), &mut in_job) };
        let error = if checked == 0 {
            Some(unsafe { GetLastError() })
        } else {
            None
        };
        let closed = unsafe { CloseHandle(process) } != 0;
        if let Some(error) = error {
            return Err(format!(
                "IsProcessInJob({pid}) failed with Win32 error {error}"
            ));
        }
        if !closed {
            return Err(format!(
                "CloseHandle(OpenProcess({pid})) failed with Win32 error {}",
                unsafe { GetLastError() }
            ));
        }
        Ok(in_job != 0)
    }

    fn process_is_alive(pid: u32) -> Result<bool, String> {
        let process = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            let error = unsafe { GetLastError() };
            return if error == 87 {
                Ok(false)
            } else {
                Err(format!(
                    "OpenProcess({pid}) failed with Win32 error {error}"
                ))
            };
        }
        let wait = unsafe { WaitForSingleObject(process, 0) };
        let error = (wait == WAIT_FAILED).then(|| unsafe { GetLastError() });
        let closed = unsafe { CloseHandle(process) } != 0;
        if let Some(error) = error {
            return Err(format!(
                "process state query for {pid} failed with Win32 error {error}"
            ));
        }
        if !closed {
            return Err(format!(
                "CloseHandle(OpenProcess({pid})) failed with Win32 error {}",
                unsafe { GetLastError() }
            ));
        }
        match wait {
            WAIT_OBJECT_0 => Ok(false),
            WAIT_TIMEOUT => Ok(true),
            other => Err(format!(
                "unexpected process wait result {other} for PID {pid}"
            )),
        }
    }

    fn wait_process_exit(pid: u32, timeout: Duration) -> Result<bool, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if !process_is_alive(pid)? {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn read_cluster_pid(cluster: &Path) -> Option<u32> {
        fs::read_to_string(cluster.join("postmaster.pid"))
            .ok()?
            .lines()
            .next()?
            .trim()
            .parse()
            .ok()
    }

    fn wait_for_cluster_pid(cluster: &Path, timeout: Duration) -> Option<u32> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(pid) = read_cluster_pid(cluster) {
                return Some(pid);
            }
            if Instant::now() >= deadline {
                return None;
            }
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_for_loopback(port: u16, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        loop {
            match TcpStream::connect_timeout(
                &format!("127.0.0.1:{port}")
                    .parse()
                    .map_err(|error| format!("invalid loopback endpoint: {error}"))?,
                Duration::from_millis(200),
            ) {
                Ok(stream) => {
                    drop(stream);
                    return Ok(());
                }
                Err(error) if Instant::now() < deadline => {
                    let _ = error;
                    thread::sleep(Duration::from_millis(25));
                }
                Err(error) => {
                    return Err(format!("PostgreSQL loopback port did not open: {error}"))
                }
            }
        }
    }

    struct RunState {
        port: u16,
        start_attempted: bool,
        postgres_pid: Option<u32>,
        graceful_stop_ok: bool,
    }

    fn exercise(
        supervisor: &mut Supervisor,
        bins: &RuntimeBins,
        profile: &DisposableProfile,
        state: &mut RunState,
    ) -> Result<(), String> {
        let init_args = vec![
            format!("--pgdata={}", profile.cluster().display()).into(),
            "--auth=trust".into(),
            "--username=orion_harness".into(),
            "--encoding=UTF8".into(),
            "--locale=C".into(),
            "--no-sync".into(),
        ];
        let (initdb_pid, initdb_code) = run_supervised(
            supervisor,
            &bins.initdb,
            &init_args,
            bins,
            profile,
            Duration::from_secs(120),
        )?;
        if initdb_code != 0 {
            return Err(format!(
                "bundled initdb PID {initdb_pid} exited with {initdb_code}"
            ));
        }

        state.start_attempted = true;
        let start_args = vec![
            "start".into(),
            "-w".into(),
            "-t".into(),
            "30".into(),
            "-D".into(),
            profile.cluster().into_os_string(),
            "-l".into(),
            profile.pg_log().into_os_string(),
            "-o".into(),
            format!("-p {} -h 127.0.0.1", state.port).into(),
        ];
        let (pg_ctl_pid, start_code) = run_supervised(
            supervisor,
            &bins.pg_ctl,
            &start_args,
            bins,
            profile,
            CHILD_WAIT,
        )?;
        if start_code != 0 {
            return Err(format!(
                "bundled pg_ctl start PID {pg_ctl_pid} exited with {start_code}"
            ));
        }

        let postgres_pid = wait_for_cluster_pid(&profile.cluster(), Duration::from_secs(5))
            .ok_or_else(|| "PostgreSQL did not publish a parseable postmaster.pid".to_owned())?;
        state.postgres_pid = Some(postgres_pid);
        if !is_process_in_job(postgres_pid)? {
            return Err(format!(
                "PostgreSQL PID {postgres_pid} is not in the supervisor Job Object"
            ));
        }
        wait_for_loopback(state.port, Duration::from_secs(10))?;
        let log = fs::read_to_string(profile.pg_log())
            .map_err(|error| format!("cannot read disposable PostgreSQL log: {error}"))?;
        let listening_line = format!("port {}", state.port);
        if !log.contains(&listening_line) || !log.contains("127.0.0.1") {
            return Err(format!(
                "PostgreSQL log does not confirm loopback port {}",
                state.port
            ));
        }
        Ok(())
    }

    fn graceful_stop_if_running(
        supervisor: &mut Supervisor,
        bins: &RuntimeBins,
        profile: &DisposableProfile,
        state: &mut RunState,
    ) -> Result<(), String> {
        if !state.start_attempted {
            return Ok(());
        }
        if state.postgres_pid.is_none() {
            state.postgres_pid = wait_for_cluster_pid(&profile.cluster(), Duration::from_secs(2));
        }
        let Some(pid) = state.postgres_pid else {
            // If startup never produced postmaster.pid, Job shutdown still
            // waits for all assigned initdb/pg_ctl descendants below.
            return Ok(());
        };
        if !process_is_alive(pid)? {
            return Ok(());
        }

        let stop_args = vec![
            "stop".into(),
            "-D".into(),
            profile.cluster().into_os_string(),
            "-m".into(),
            "fast".into(),
            "-w".into(),
            "-t".into(),
            "10".into(),
        ];
        let (pg_ctl_pid, stop_code) = run_supervised(
            supervisor,
            &bins.pg_ctl,
            &stop_args,
            bins,
            profile,
            STOP_WAIT,
        )?;
        if stop_code != 0 {
            return Err(format!(
                "bundled pg_ctl stop PID {pg_ctl_pid} exited with {stop_code}"
            ));
        }
        if !wait_process_exit(pid, Duration::from_secs(10))? {
            return Err(format!(
                "PostgreSQL PID {pid} survived successful pg_ctl stop"
            ));
        }
        state.graceful_stop_ok = true;
        Ok(())
    }

    fn run_experiment() -> Result<String, String> {
        if std::env::var("ORION_RUN_POSTGRES_LIFECYCLE_HARNESS").as_deref() != Ok(OPT_IN) {
            return Err(format!(
                "explicit opt-in required: set ORION_RUN_POSTGRES_LIFECYCLE_HARNESS={OPT_IN}"
            ));
        }
        let bins = find_bundled_bins()?;
        let mut profile = DisposableProfile::create()?;
        let port = allocate_random_port()?;
        let mut supervisor = Supervisor::new().map_err(|error| error.to_string())?;
        let mut state = RunState {
            port,
            start_attempted: false,
            postgres_pid: None,
            graceful_stop_ok: false,
        };

        // Always attempt pg_ctl stop before the Job Object is terminated.
        let experiment_result = exercise(&mut supervisor, &bins, &profile, &mut state);
        let stop_result = graceful_stop_if_running(&mut supervisor, &bins, &profile, &mut state);

        // If graceful pg_ctl stop failed, bounded Job termination is the
        // fail-closed fallback. A running server PID is checked again below.
        let job_result = supervisor
            .terminate_all()
            .map_err(|error| error.to_string());
        drop(supervisor);

        let server_stopped = match state.postgres_pid {
            Some(pid) => wait_process_exit(pid, Duration::from_secs(10))
                .map_err(|error| error)
                .and_then(|stopped| {
                    if stopped {
                        Ok(())
                    } else {
                        Err(format!(
                            "PostgreSQL PID {pid} remains alive after Job shutdown"
                        ))
                    }
                }),
            None => Ok(()),
        };
        let safe_to_remove_profile = job_result.is_ok() && server_stopped.is_ok();
        if safe_to_remove_profile {
            profile.allow_cleanup_after_verified_shutdown()?;
        }

        let mut failures = Vec::new();
        if let Err(error) = experiment_result {
            failures.push(format!("exercise failed: {error}"));
        }
        if let Err(error) = stop_result {
            failures.push(format!("graceful pg_ctl stop failed: {error}"));
        }
        if !state.graceful_stop_ok {
            failures.push("pg_ctl stop was not verified before Job shutdown".into());
        }
        if let Err(error) = job_result {
            failures.push(format!("bounded Job shutdown failed: {error}"));
        }
        if let Err(error) = server_stopped {
            failures.push(format!("process teardown could not be verified: {error}"));
        }
        if !failures.is_empty() {
            let cleanup_note = if safe_to_remove_profile {
                format!(
                    "disposable profile {} is safe to remove",
                    profile.root.display()
                )
            } else {
                format!("disposable profile retained at {}", profile.root.display())
            };
            return Err(format!("{}; {cleanup_note}", failures.join("; ")));
        }

        let report = format!(
            "bundled initdb, pg_ctl and PostgreSQL completed in disposable profile; pg_ctl and PostgreSQL were observed in the supervisor Job; pg_ctl stop completed before bounded Job shutdown; PID {} stopped; ephemeral loopback port {} verified",
            state.postgres_pid.unwrap_or_default(),
            state.port
        );
        drop(profile);
        Ok(report)
    }

    #[test]
    fn bundled_postgres_lifecycle_is_contained_and_stops_gracefully() {
        let result = run_experiment();
        assert!(result.is_ok(), "{}", result.unwrap_err());
    }
}
