//! Experimental process lifecycle primitive for the ORION-Rust runtime.
//!
//! This module is only included by tests today; it is not part of production
//! startup or the product launcher. Windows children are created suspended,
//! assigned to a kill-on-close Job Object, and resumed only after every
//! containment step has succeeded. It is a process-tree cleanup primitive, not
//! a security sandbox.

use std::ffi::OsString;
use std::path::PathBuf;

/// Environment inheritance policy for a supervised child.
#[derive(Clone, Debug)]
pub enum EnvironmentPolicy {
    /// Preserve the caller's environment. This is the explicit default for
    /// [`ProcessSpec::new`].
    Inherit,
    /// Start with an empty environment, copy only named inherited variables,
    /// then apply explicit values from [`ProcessSpec::env`].
    Isolated {
        allowlist: Vec<OsString>,
        values: Vec<(OsString, OsString)>,
    },
}

/// An executable and arguments for a child process owned by [`Supervisor`].
///
/// `program` and an optional `current_dir` must be absolute paths. The default
/// environment policy inherits the parent environment. Call
/// [`Self::isolated_environment`] to start clean, optionally adding named
/// inherited values through [`Self::allow_env`] and explicit values through
/// [`Self::env`]. Children do not inherit open handles.
#[derive(Clone, Debug)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub current_dir: Option<PathBuf>,
    pub environment: EnvironmentPolicy,
}

impl ProcessSpec {
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            current_dir: None,
            environment: EnvironmentPolicy::Inherit,
        }
    }

    pub fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn current_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.current_dir = Some(dir.into());
        self
    }

    /// Select a clean child environment with no inherited values.
    pub fn isolated_environment(mut self) -> Self {
        self.environment = EnvironmentPolicy::Isolated {
            allowlist: Vec::new(),
            values: Vec::new(),
        };
        self
    }

    /// Copy one named variable from the parent into an isolated environment.
    /// Calling this method opts into [`EnvironmentPolicy::Isolated`].
    pub fn allow_env(mut self, name: impl Into<OsString>) -> Self {
        self.isolated_parts_mut().0.push(name.into());
        self
    }

    /// Set one explicit child environment value. Calling this method opts into
    /// [`EnvironmentPolicy::Isolated`], so unrelated parent values stay out.
    pub fn env(mut self, name: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.isolated_parts_mut()
            .1
            .push((name.into(), value.into()));
        self
    }

    /// Restore the documented default behavior and inherit the parent environment.
    pub fn inherit_environment(mut self) -> Self {
        self.environment = EnvironmentPolicy::Inherit;
        self
    }

    fn isolated_parts_mut(&mut self) -> (&mut Vec<OsString>, &mut Vec<(OsString, OsString)>) {
        if matches!(self.environment, EnvironmentPolicy::Inherit) {
            self.environment = EnvironmentPolicy::Isolated {
                allowlist: Vec::new(),
                values: Vec::new(),
            };
        }
        match &mut self.environment {
            EnvironmentPolicy::Isolated { allowlist, values } => (allowlist, values),
            EnvironmentPolicy::Inherit => unreachable!("isolated mode was selected above"),
        }
    }
}

#[derive(Debug)]
pub struct SupervisorError(String);

impl std::fmt::Display for SupervisorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SupervisorError {}

/// Owns a Windows Job Object and all direct child process handles.
///
/// Dropping this value terminates the whole job and waits for it to become
/// empty. For a real ORION runtime, call the application-specific graceful
/// shutdown hooks (including `pg_ctl stop`) before dropping the supervisor.
pub struct Supervisor {
    #[cfg(windows)]
    job: windows::Job,
    #[cfg(windows)]
    children: Vec<windows::ManagedChild>,
    #[cfg(not(windows))]
    _unsupported: (),
}

impl Supervisor {
    /// Create and configure a kill-on-close Job Object before starting children.
    pub fn new() -> Result<Self, SupervisorError> {
        #[cfg(windows)]
        {
            Ok(Self {
                job: windows::Job::new()?,
                children: Vec::new(),
            })
        }
        #[cfg(not(windows))]
        {
            Err(SupervisorError(
                "the experimental supervisor currently requires Windows".into(),
            ))
        }
    }

    #[cfg(all(test, windows))]
    fn new_with_fault(
        fault: windows::FaultPoint,
    ) -> (
        Result<Self, SupervisorError>,
        std::sync::Arc<windows::TestHooks>,
    ) {
        let hooks = std::sync::Arc::new(windows::TestHooks::new(fault));
        let result =
            windows::Job::new_with_hooks(Some(std::sync::Arc::clone(&hooks))).map(|job| Self {
                job,
                children: Vec::new(),
            });
        (result, hooks)
    }

    /// Start a child suspended, assign it to the job, then resume it.
    ///
    /// If process creation, job assignment, or resume fails, the child is
    /// terminated before this method returns an error. No fallback to an
    /// uncontained process is attempted.
    pub fn spawn(&mut self, spec: ProcessSpec) -> Result<u32, SupervisorError> {
        #[cfg(windows)]
        {
            if self.job.is_unusable() {
                return Err(SupervisorError(
                    "cannot start a child after this supervisor has been terminated or failed closed".into(),
                ));
            }
            match windows::ManagedChild::spawn(&mut self.job, spec) {
                Ok(child) => {
                    let pid = child.pid;
                    self.children.push(child);
                    Ok(pid)
                }
                Err(error) => {
                    // A partial startup invalidates the whole stack. Kill
                    // earlier children too, then reject every later spawn.
                    match self.job.terminate_and_wait() {
                        Ok(()) => Err(error),
                        Err(cleanup) => {
                            self.job.close_kill_on_close();
                            Err(SupervisorError(format!(
                                "{error}; supervisor cleanup failed: {cleanup}; Job Object closed"
                            )))
                        }
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            let _ = spec;
            Err(SupervisorError(
                "the experimental supervisor currently requires Windows".into(),
            ))
        }
    }

    /// Wait for a direct child to exit and return its process exit code.
    ///
    /// Returns `Ok(None)` when `timeout` expires. This only observes the direct
    /// child; descendants remain contained by the Job Object and are handled
    /// by [`Self::terminate_all`] or Drop. The timeout is finite even when it
    /// exceeds the maximum millisecond value accepted by Win32.
    pub fn wait_for_exit(
        &self,
        pid: u32,
        timeout: std::time::Duration,
    ) -> Result<Option<u32>, SupervisorError> {
        #[cfg(windows)]
        {
            let child = self
                .children
                .iter()
                .find(|child| child.pid == pid)
                .ok_or_else(|| SupervisorError(format!("unknown supervised child PID {pid}")))?;
            child.wait_for_exit(timeout)
        }
        #[cfg(not(windows))]
        {
            let _ = (pid, timeout);
            Err(SupervisorError(
                "the experimental supervisor currently requires Windows".into(),
            ))
        }
    }

    /// Terminate every process in the job and wait for the process tree to exit.
    pub fn terminate_all(&mut self) -> Result<(), SupervisorError> {
        #[cfg(windows)]
        {
            match self.job.terminate_and_wait() {
                Ok(()) => Ok(()),
                Err(error) => {
                    self.job.close_kill_on_close();
                    Err(error)
                }
            }
        }
        #[cfg(not(windows))]
        {
            Err(SupervisorError(
                "the experimental supervisor currently requires Windows".into(),
            ))
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::{EnvironmentPolicy, ProcessSpec, SupervisorError};
    use std::ffi::{c_void, OsStr, OsString};
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    #[cfg(test)]
    use std::sync::{
        atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;

    type Handle = *mut c_void;

    const CREATE_SUSPENDED: u32 = 0x0000_0004;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_UNICODE_ENVIRONMENT: u32 = 0x0000_0400;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 258;
    const WAIT_FAILED: u32 = 0xFFFF_FFFF;
    const JOB_TERMINATION_TIMEOUT_MS: u32 = 10_000;

    #[cfg(test)]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) enum FaultPoint {
        CreateJobObject,
        SetInformationJobObject,
        AssignProcessToJobObject,
        ResumeThread,
        TerminateJobObject,
    }

    #[cfg(test)]
    pub(super) struct TestHooks {
        fault: FaultPoint,
        job_created: AtomicBool,
        child_pid: AtomicU32,
        closed_handles: AtomicUsize,
        close_failures: AtomicUsize,
    }

    #[cfg(test)]
    impl TestHooks {
        pub(super) fn new(fault: FaultPoint) -> Self {
            Self {
                fault,
                job_created: AtomicBool::new(false),
                child_pid: AtomicU32::new(0),
                closed_handles: AtomicUsize::new(0),
                close_failures: AtomicUsize::new(0),
            }
        }

        fn fails(&self, point: FaultPoint) -> bool {
            self.fault == point
        }

        pub(super) fn job_was_created(&self) -> bool {
            self.job_created.load(Ordering::SeqCst)
        }

        pub(super) fn child_pid(&self) -> u32 {
            self.child_pid.load(Ordering::SeqCst)
        }

        pub(super) fn closed_handles(&self) -> usize {
            self.closed_handles.load(Ordering::SeqCst)
        }

        pub(super) fn close_failures(&self) -> usize {
            self.close_failures.load(Ordering::SeqCst)
        }
    }

    #[cfg(test)]
    fn close_handle(handle: Handle, hooks: Option<&Arc<TestHooks>>) {
        if handle.is_null() {
            return;
        }
        let closed = unsafe { CloseHandle(handle) } != 0;
        if let Some(hooks) = hooks {
            if closed {
                hooks.closed_handles.fetch_add(1, Ordering::SeqCst);
            } else {
                hooks.close_failures.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    #[cfg(not(test))]
    fn close_handle(handle: Handle) {
        if !handle.is_null() {
            unsafe {
                CloseHandle(handle);
            }
        }
    }

    #[repr(C)]
    struct StartupInfoW {
        cb: u32,
        lp_reserved: *mut u16,
        lp_desktop: *mut u16,
        lp_title: *mut u16,
        dw_x: u32,
        dw_y: u32,
        dw_x_size: u32,
        dw_y_size: u32,
        dw_x_count_chars: u32,
        dw_y_count_chars: u32,
        dw_fill_attribute: u32,
        dw_flags: u32,
        w_show_window: u16,
        cb_reserved2: u16,
        lp_reserved2: *mut u8,
        h_std_input: Handle,
        h_std_output: Handle,
        h_std_error: Handle,
    }

    #[repr(C)]
    struct ProcessInformation {
        h_process: Handle,
        h_thread: Handle,
        dw_process_id: u32,
        dw_thread_id: u32,
    }

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic: BasicLimitInformation,
        io: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, len: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CreateProcessW(
            application_name: *const u16,
            command_line: *mut u16,
            process_attributes: *mut c_void,
            thread_attributes: *mut c_void,
            inherit_handles: i32,
            creation_flags: u32,
            environment: *mut c_void,
            current_directory: *const u16,
            startup_info: *mut StartupInfoW,
            process_information: *mut ProcessInformation,
        ) -> i32;
        fn ResumeThread(thread: Handle) -> u32;
        fn TerminateProcess(process: Handle, exit_code: u32) -> i32;
        fn TerminateThread(thread: Handle, exit_code: u32) -> i32;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetLastError() -> u32;
        fn GetExitCodeProcess(process: Handle, exit_code: *mut u32) -> i32;
    }

    pub struct Job {
        handle: Handle,
        terminated: bool,
        poisoned: bool,
        #[cfg(test)]
        hooks: Option<Arc<TestHooks>>,
    }

    impl Job {
        pub fn new() -> Result<Self, SupervisorError> {
            #[cfg(test)]
            return Self::new_internal(None);
            #[cfg(not(test))]
            Self::new_internal()
        }

        #[cfg(test)]
        pub(super) fn new_with_hooks(
            hooks: Option<Arc<TestHooks>>,
        ) -> Result<Self, SupervisorError> {
            Self::new_internal(hooks)
        }

        fn new_internal(
            #[cfg(test)] hooks: Option<Arc<TestHooks>>,
        ) -> Result<Self, SupervisorError> {
            #[cfg(test)]
            let injected = hooks
                .as_ref()
                .is_some_and(|hooks| hooks.fails(FaultPoint::CreateJobObject));
            #[cfg(not(test))]
            let injected = false;
            let handle = if injected {
                null_mut()
            } else {
                unsafe { CreateJobObjectW(null(), null()) }
            };
            if handle.is_null() {
                if injected {
                    return Err(SupervisorError("injected CreateJobObjectW failure".into()));
                }
                return Err(last_error("CreateJobObjectW"));
            }
            #[cfg(test)]
            if let Some(hooks) = &hooks {
                hooks.job_created.store(true, Ordering::SeqCst);
            }
            let job = Self {
                handle,
                terminated: false,
                poisoned: false,
                #[cfg(test)]
                hooks,
            };
            #[cfg(test)]
            if job
                .hooks
                .as_ref()
                .is_some_and(|hooks| hooks.fails(FaultPoint::SetInformationJobObject))
            {
                return Err(SupervisorError(
                    "injected SetInformationJobObject failure".into(),
                ));
            }
            let mut info: ExtendedLimitInformation = unsafe { std::mem::zeroed() };
            info.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            #[cfg(test)]
            let fail_set_information = job
                .hooks
                .as_ref()
                .is_some_and(|hooks| hooks.fails(FaultPoint::SetInformationJobObject));
            #[cfg(not(test))]
            let fail_set_information = false;
            if fail_set_information {
                return Err(SupervisorError(
                    "injected SetInformationJobObject failure".into(),
                ));
            }
            let ok = unsafe {
                SetInformationJobObject(
                    job.handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<ExtendedLimitInformation>() as u32,
                )
            };
            if ok == 0 {
                return Err(last_error("SetInformationJobObject(KILL_ON_JOB_CLOSE)"));
            }
            Ok(job)
        }

        pub fn terminate_and_wait(&mut self) -> Result<(), SupervisorError> {
            if self.terminated {
                return Ok(());
            }
            // Even if a Win32 call fails, the owner must not start more work;
            // closing this kill-on-close job remains the cleanup fallback.
            self.poisoned = true;
            #[cfg(test)]
            let injected = self
                .hooks
                .as_ref()
                .is_some_and(|hooks| hooks.fails(FaultPoint::TerminateJobObject));
            #[cfg(not(test))]
            let injected = false;
            let ok = !injected && unsafe { TerminateJobObject(self.handle, 1) } != 0;
            if !ok {
                if injected {
                    return Err(SupervisorError(
                        "injected TerminateJobObject failure".into(),
                    ));
                }
                return Err(last_error("TerminateJobObject"));
            }
            match unsafe { WaitForSingleObject(self.handle, JOB_TERMINATION_TIMEOUT_MS) } {
                WAIT_OBJECT_0 => {
                    self.terminated = true;
                    Ok(())
                }
                WAIT_FAILED => Err(last_error("WaitForSingleObject(job)")),
                result => Err(SupervisorError(format!(
                    "unexpected Job Object wait result {result}"
                ))),
            }
        }

        pub fn is_unusable(&self) -> bool {
            self.terminated || self.poisoned
        }

        pub fn close_kill_on_close(&mut self) {
            self.poisoned = true;
            self.terminated = true;
            if !self.handle.is_null() {
                #[cfg(test)]
                close_handle(self.handle, self.hooks.as_ref());
                #[cfg(not(test))]
                close_handle(self.handle);
                self.handle = null_mut();
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            if !self.terminated {
                // Try to wait for termination. Closing the configured job is
                // still the OS-level fallback if TerminateJobObject fails.
                if !self.poisoned {
                    let _ = self.terminate_and_wait();
                }
            }
            if !self.handle.is_null() {
                #[cfg(test)]
                close_handle(self.handle, self.hooks.as_ref());
                #[cfg(not(test))]
                close_handle(self.handle);
                self.handle = null_mut();
            }
        }
    }

    pub struct ManagedChild {
        process: Handle,
        thread: Handle,
        pub pid: u32,
        #[cfg(test)]
        hooks: Option<Arc<TestHooks>>,
    }

    impl ManagedChild {
        pub(super) fn wait_for_exit(
            &self,
            timeout: Duration,
        ) -> Result<Option<u32>, SupervisorError> {
            // INFINITE (u32::MAX) is intentionally never passed: a very large
            // caller timeout is clamped to the largest finite Win32 timeout.
            let timeout_ms = timeout.as_millis().min((u32::MAX - 1) as u128) as u32;
            match unsafe { WaitForSingleObject(self.process, timeout_ms) } {
                WAIT_OBJECT_0 => {
                    let mut exit_code = 0;
                    if unsafe { GetExitCodeProcess(self.process, &mut exit_code) } == 0 {
                        return Err(last_error("GetExitCodeProcess"));
                    }
                    Ok(Some(exit_code))
                }
                WAIT_TIMEOUT => Ok(None),
                WAIT_FAILED => Err(last_error("WaitForSingleObject(child)")),
                result => Err(SupervisorError(format!(
                    "unexpected child wait result {result}"
                ))),
            }
        }

        pub fn spawn(job: &mut Job, spec: ProcessSpec) -> Result<Self, SupervisorError> {
            if !spec.program.is_absolute() {
                return Err(SupervisorError(format!(
                    "child executable path must be absolute: {}",
                    spec.program.display()
                )));
            }
            if spec
                .current_dir
                .as_ref()
                .is_some_and(|path| !path.is_absolute())
            {
                return Err(SupervisorError(
                    "child working directory must be absolute".into(),
                ));
            }
            let app_name = wide_nul(spec.program.as_os_str(), "child executable")?;
            let mut argv = Vec::with_capacity(spec.args.len() + 1);
            argv.push(spec.program.clone().into_os_string());
            argv.extend(spec.args);
            let mut command_line = encode_command_line(&argv)?;
            let mut startup: StartupInfoW = unsafe { std::mem::zeroed() };
            startup.cb = std::mem::size_of::<StartupInfoW>() as u32;
            let mut info: ProcessInformation = unsafe { std::mem::zeroed() };
            let current_dir = spec
                .current_dir
                .as_ref()
                .map(|path| wide_nul(path.as_os_str(), "working directory"))
                .transpose()?;
            let current_dir_ptr = current_dir.as_ref().map_or(null(), |value| value.as_ptr());
            let mut environment = build_environment_block(&spec.environment)?;
            let (environment_ptr, environment_flags) = match environment.as_mut() {
                Some(block) => (block.as_mut_ptr().cast(), CREATE_UNICODE_ENVIRONMENT),
                None => (null_mut(), 0),
            };

            let created = unsafe {
                CreateProcessW(
                    app_name.as_ptr(),
                    command_line.as_mut_ptr(),
                    null_mut(),
                    null_mut(),
                    0,
                    CREATE_SUSPENDED | CREATE_NO_WINDOW | environment_flags,
                    environment_ptr,
                    current_dir_ptr,
                    &mut startup,
                    &mut info,
                )
            };
            if created == 0 {
                return Err(last_error("CreateProcessW(CREATE_SUSPENDED)"));
            }

            let mut child = Self {
                process: info.h_process,
                thread: info.h_thread,
                pid: info.dw_process_id,
                #[cfg(test)]
                hooks: job.hooks.clone(),
            };
            #[cfg(test)]
            if let Some(hooks) = &child.hooks {
                hooks.child_pid.store(child.pid, Ordering::SeqCst);
            }
            #[cfg(test)]
            let assignment_failed = child
                .hooks
                .as_ref()
                .is_some_and(|hooks| hooks.fails(FaultPoint::AssignProcessToJobObject));
            #[cfg(not(test))]
            let assignment_failed = false;
            let assigned = !assignment_failed
                && unsafe { AssignProcessToJobObject(job.handle, child.process) } != 0;
            if !assigned {
                let assign_error = if assignment_failed {
                    SupervisorError("injected AssignProcessToJobObject failure".into())
                } else {
                    last_error("AssignProcessToJobObject")
                };
                return match child.terminate_suspended() {
                    Ok(()) => Err(assign_error),
                    Err(cleanup_error) => {
                        // This process was never resumed. Preserve its handles
                        // if the kernel refuses termination so it cannot become
                        // a running orphan and an operator can still inspect it.
                        let pid = child.pid;
                        std::mem::forget(child);
                        Err(SupervisorError(format!(
                            "{assign_error}; failed to terminate suspended child {pid}: {cleanup_error}"
                        )))
                    }
                };
            }
            #[cfg(test)]
            let resume_failed = child
                .hooks
                .as_ref()
                .is_some_and(|hooks| hooks.fails(FaultPoint::ResumeThread));
            #[cfg(not(test))]
            let resume_failed = false;
            let previous_suspend_count = if resume_failed {
                u32::MAX
            } else {
                unsafe { ResumeThread(child.thread) }
            };
            if previous_suspend_count != 1 {
                let resume_error = if previous_suspend_count == u32::MAX {
                    if resume_failed {
                        SupervisorError("injected ResumeThread failure".into())
                    } else {
                        last_error("ResumeThread")
                    }
                } else {
                    SupervisorError(format!(
                        "ResumeThread returned unexpected suspend count {previous_suspend_count}"
                    ))
                };
                // It is already assigned, so killing the complete job handles
                // even a child which unexpectedly resumed before reporting error.
                let cleanup = job.terminate_and_wait();
                if let Err(cleanup_error) = cleanup {
                    let _ = child.terminate_resumed_or_suspended();
                    return Err(SupervisorError(format!(
                        "{resume_error}; failed to terminate the Job Object: {cleanup_error}"
                    )));
                }
                child.wait_ignoring_error(Duration::from_secs(5));
                return Err(resume_error);
            }
            #[cfg(test)]
            close_handle(child.thread, child.hooks.as_ref());
            #[cfg(not(test))]
            close_handle(child.thread);
            child.thread = null_mut();
            Ok(child)
        }

        fn terminate_suspended(&mut self) -> Result<(), SupervisorError> {
            if self.process.is_null() {
                return Ok(());
            }
            if unsafe { TerminateProcess(self.process, 1) } == 0
                && unsafe { WaitForSingleObject(self.process, 0) } != WAIT_OBJECT_0
            {
                let process_error = last_error("TerminateProcess(suspended child)");
                if self.thread.is_null() || unsafe { TerminateThread(self.thread, 1) } == 0 {
                    return Err(SupervisorError(format!(
                        "{process_error}; TerminateThread(suspended child) failed: {}",
                        last_error("TerminateThread")
                    )));
                }
            }
            match unsafe { WaitForSingleObject(self.process, 5_000) } {
                WAIT_OBJECT_0 => {
                    self.close_handles();
                    Ok(())
                }
                WAIT_FAILED => Err(last_error("WaitForSingleObject(suspended child)")),
                result => Err(SupervisorError(format!(
                    "suspended child {} did not terminate (wait result {result})",
                    self.pid
                ))),
            }
        }

        fn terminate_resumed_or_suspended(&self) -> Result<(), SupervisorError> {
            if unsafe { TerminateProcess(self.process, 1) } == 0
                && unsafe { WaitForSingleObject(self.process, 0) } != WAIT_OBJECT_0
            {
                return Err(last_error(
                    "TerminateProcess(child after Job Object failure)",
                ));
            }
            match unsafe { WaitForSingleObject(self.process, 5_000) } {
                WAIT_OBJECT_0 => Ok(()),
                WAIT_FAILED => Err(last_error(
                    "WaitForSingleObject(child after Job Object failure)",
                )),
                result => Err(SupervisorError(format!(
                    "child {} did not terminate (wait result {result})",
                    self.pid
                ))),
            }
        }

        fn wait_ignoring_error(&self, timeout: Duration) {
            unsafe {
                WaitForSingleObject(
                    self.process,
                    timeout.as_millis().min(u32::MAX as u128) as u32,
                );
            }
        }

        fn close_handles(&mut self) {
            if !self.thread.is_null() {
                #[cfg(test)]
                close_handle(self.thread, self.hooks.as_ref());
                #[cfg(not(test))]
                close_handle(self.thread);
                self.thread = null_mut();
            }
            if !self.process.is_null() {
                #[cfg(test)]
                close_handle(self.process, self.hooks.as_ref());
                #[cfg(not(test))]
                close_handle(self.process);
                self.process = null_mut();
            }
        }
    }

    impl Drop for ManagedChild {
        fn drop(&mut self) {
            self.close_handles();
        }
    }

    fn wide_nul(value: &OsStr, label: &str) -> Result<Vec<u16>, SupervisorError> {
        let wide: Vec<u16> = value.encode_wide().collect();
        if wide.contains(&0) {
            return Err(SupervisorError(format!("{label} contains a NUL character")));
        }
        let mut result = wide;
        result.push(0);
        Ok(result)
    }

    pub(super) fn build_environment_block(
        policy: &EnvironmentPolicy,
    ) -> Result<Option<Vec<u16>>, SupervisorError> {
        let EnvironmentPolicy::Isolated { allowlist, values } = policy else {
            return Ok(None);
        };

        fn validate_name(name: &OsStr) -> Result<String, SupervisorError> {
            let name = name.to_str().ok_or_else(|| {
                SupervisorError("environment variable name must be valid Unicode".into())
            })?;
            if name.is_empty() || name.contains('=') || name.contains('\0') {
                return Err(SupervisorError(
                    "invalid environment variable name (value omitted)".into(),
                ));
            }
            Ok(name.to_lowercase())
        }

        fn validate_value(value: &OsStr) -> Result<(), SupervisorError> {
            if value.encode_wide().any(|unit| unit == 0) {
                return Err(SupervisorError(
                    "environment variable value contains NUL (value omitted)".into(),
                ));
            }
            Ok(())
        }

        let mut entries = std::collections::BTreeMap::<String, (OsString, OsString)>::new();
        let inherited: Vec<(OsString, OsString)> = std::env::vars_os().collect();
        for name in allowlist {
            let folded_name = validate_name(name)?;
            let mut matches = inherited.iter().filter(|(inherited_name, _)| {
                inherited_name
                    .to_str()
                    .is_some_and(|candidate| candidate.to_lowercase() == folded_name)
            });
            if let Some((inherited_name, inherited_value)) = matches.next() {
                validate_value(inherited_value)?;
                if let Some((_, other_value)) = matches.next() {
                    if other_value != inherited_value {
                        return Err(SupervisorError(
                            "ambiguous inherited environment variable (value omitted)".into(),
                        ));
                    }
                }
                entries.insert(
                    folded_name,
                    (inherited_name.clone(), inherited_value.clone()),
                );
            }
        }

        let mut override_names = std::collections::HashSet::new();
        for (name, value) in values {
            let folded_name = validate_name(name)?;
            validate_value(value)?;
            if !override_names.insert(folded_name.clone()) {
                return Err(SupervisorError(
                    "duplicate isolated environment variable (value omitted)".into(),
                ));
            }
            entries.insert(folded_name, (name.clone(), value.clone()));
        }

        let mut block = Vec::new();
        for (name, value) in entries.into_values() {
            block.extend(name.encode_wide());
            block.push(b'=' as u16);
            block.extend(value.encode_wide());
            block.push(0);
        }
        // CreateProcessW requires a double NUL terminator, including for an
        // intentionally empty environment.
        block.push(0);
        if block.len() == 1 {
            block.push(0);
        }
        Ok(Some(block))
    }

    fn encode_command_line(argv: &[std::ffi::OsString]) -> Result<Vec<u16>, SupervisorError> {
        let mut line = Vec::new();
        for (index, arg) in argv.iter().enumerate() {
            if index > 0 {
                line.push(b' ' as u16);
            }
            let wide: Vec<u16> = arg.encode_wide().collect();
            if wide.contains(&0) {
                return Err(SupervisorError(
                    "child argument contains a NUL character".into(),
                ));
            }
            line.push(b'"' as u16);
            let mut slashes = 0usize;
            for unit in &wide {
                if *unit == b'\\' as u16 {
                    slashes += 1;
                    continue;
                }
                if *unit == b'"' as u16 {
                    line.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2 + 1));
                    line.push(*unit);
                } else {
                    line.extend(std::iter::repeat_n(b'\\' as u16, slashes));
                    line.push(*unit);
                }
                slashes = 0;
            }
            line.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
            line.push(b'"' as u16);
        }
        line.push(0);
        Ok(line)
    }

    fn last_error(operation: &str) -> SupervisorError {
        let code = unsafe { GetLastError() } as i32;
        let error = io::Error::from_raw_os_error(code);
        SupervisorError(format!("{operation} failed ({code}): {error}"))
    }

    #[cfg(test)]
    pub(super) fn process_is_signaled(pid: u32) -> Result<bool, String> {
        const SYNCHRONIZE: u32 = 0x0010_0000;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        }
        let process = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            let code = unsafe { GetLastError() };
            return if code == 87 {
                Ok(true) // ERROR_INVALID_PARAMETER: PID no longer exists.
            } else {
                Err(format!("OpenProcess({pid}) failed with Win32 error {code}"))
            };
        }
        let result = unsafe { WaitForSingleObject(process, 0) };
        let closed = unsafe { CloseHandle(process) } != 0;
        if !closed {
            return Err(format!(
                "CloseHandle(OpenProcess({pid})) failed with Win32 error {}",
                unsafe { GetLastError() }
            ));
        }
        match result {
            WAIT_OBJECT_0 => Ok(true),
            258 => Ok(false),
            WAIT_FAILED => Err(format!(
                "WaitForSingleObject(OpenProcess({pid})) failed with Win32 error {}",
                unsafe { GetLastError() }
            )),
            other => Err(format!("unexpected process wait result {other}")),
        }
    }

    #[cfg(test)]
    pub(super) fn wait_pid(pid: u32, timeout: Duration) -> Result<bool, String> {
        const SYNCHRONIZE: u32 = 0x0010_0000;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        }
        let process = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            let code = unsafe { GetLastError() };
            return if code == 87 {
                Ok(true)
            } else {
                Err(format!("OpenProcess({pid}) failed with Win32 error {code}"))
            };
        }
        let result = unsafe {
            WaitForSingleObject(process, timeout.as_millis().min(u32::MAX as u128) as u32)
        };
        let closed = unsafe { CloseHandle(process) } != 0;
        if !closed {
            return Err(format!(
                "CloseHandle(OpenProcess({pid})) failed with Win32 error {}",
                unsafe { GetLastError() }
            ));
        }
        match result {
            WAIT_OBJECT_0 => Ok(true),
            258 => Ok(false),
            WAIT_FAILED => Err(format!(
                "WaitForSingleObject(OpenProcess({pid})) failed with Win32 error {}",
                unsafe { GetLastError() }
            )),
            other => Err(format!("unexpected process wait result {other}")),
        }
    }

    #[cfg(test)]
    pub(super) fn force_terminate_pid(pid: u32) -> Result<(), String> {
        const PROCESS_TERMINATE: u32 = 0x0001;
        const SYNCHRONIZE: u32 = 0x0010_0000;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
            fn TerminateProcess(process: Handle, exit_code: u32) -> i32;
        }
        let process = unsafe { OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            let code = unsafe { GetLastError() };
            return if code == 87 {
                Ok(())
            } else {
                Err(format!(
                    "OpenProcess(terminate {pid}) failed with Win32 error {code}"
                ))
            };
        }
        if unsafe { TerminateProcess(process, 1) } == 0
            && unsafe { WaitForSingleObject(process, 0) } != WAIT_OBJECT_0
        {
            let error = unsafe { GetLastError() };
            unsafe {
                CloseHandle(process);
            }
            return Err(format!(
                "TerminateProcess({pid}) failed with Win32 error {error}"
            ));
        }
        let result = unsafe { WaitForSingleObject(process, 5_000) };
        let wait_error = (result == WAIT_FAILED).then(|| unsafe { GetLastError() });
        let closed = unsafe { CloseHandle(process) } != 0;
        if let Some(error) = wait_error {
            return Err(format!(
                "WaitForSingleObject({pid}) failed with Win32 error {error}"
            ));
        }
        if !closed {
            return Err(format!(
                "CloseHandle(OpenProcess({pid})) failed with Win32 error {}",
                unsafe { GetLastError() }
            ));
        }
        if result == WAIT_OBJECT_0 {
            Ok(())
        } else {
            Err(format!(
                "process {pid} did not terminate (wait result {result})"
            ))
        }
    }
}

#[cfg(not(windows))]
impl Drop for Supervisor {
    fn drop(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    use std::fs;
    #[cfg(windows)]
    use std::sync::{Mutex, OnceLock};
    #[cfg(windows)]
    use std::thread;
    #[cfg(windows)]
    use std::time::{Duration, Instant};

    #[cfg(windows)]
    static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[cfg(windows)]
    struct RestoreEnv {
        name: &'static str,
        old: Option<std::ffi::OsString>,
    }

    #[cfg(windows)]
    impl RestoreEnv {
        fn set(name: &'static str, value: &std::ffi::OsStr) -> Self {
            let old = std::env::var_os(name);
            std::env::set_var(name, value);
            Self { name, old }
        }
    }

    #[cfg(windows)]
    impl Drop for RestoreEnv {
        fn drop(&mut self) {
            if let Some(value) = &self.old {
                std::env::set_var(self.name, value);
            } else {
                std::env::remove_var(self.name);
            }
        }
    }

    #[cfg(windows)]
    struct ChildReaper(u32);

    #[cfg(windows)]
    impl Drop for ChildReaper {
        fn drop(&mut self) {
            if self.0 != 0 {
                let _ = windows::force_terminate_pid(self.0);
            }
        }
    }

    #[cfg(windows)]
    fn assert_injected_child_failure(fault: windows::FaultPoint, expected: &str) {
        let _guard = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let marker = std::env::temp_dir().join(format!(
            "orion-supervisor-must-not-run-{}-{fault:?}.txt",
            std::process::id()
        ));
        let _ = fs::remove_file(&marker);
        let restore = RestoreEnv::set("ORION_SUPERVISOR_EXECUTION_MARKER", marker.as_os_str());
        let (result, hooks) = Supervisor::new_with_fault(fault);
        let mut supervisor = result.expect("Job Object setup should succeed for this fault point");
        let exe = std::env::current_exe().expect("test executable path");
        let error = supervisor
            .spawn(
                ProcessSpec::new(exe.clone())
                    .arg("--ignored")
                    .arg("windows_test_must_not_run")
                    .arg("--nocapture")
                    .current_dir(std::env::temp_dir()),
            )
            .unwrap_err();
        drop(restore);
        assert!(
            error.to_string().contains(expected),
            "unexpected error: {error}"
        );

        let pid = hooks.child_pid();
        assert_ne!(pid, 0, "the fault must be injected after process creation");
        let _reaper = ChildReaper(pid);
        assert!(
            windows::wait_pid(pid, Duration::from_secs(5)).expect("query child process state"),
            "injected {expected} failure left suspended child {pid} alive"
        );
        assert!(
            !marker.exists(),
            "child {pid} ran despite injected {expected} failure"
        );
        assert!(
            supervisor.job.is_unusable(),
            "spawn failure must poison the supervisor"
        );
        let follow_up = supervisor.spawn(ProcessSpec::new(exe)).unwrap_err();
        assert!(follow_up.to_string().contains("failed closed"));

        drop(supervisor);
        assert_eq!(
            hooks.closed_handles(),
            3,
            "job, process, and thread handles must close exactly once"
        );
        assert_eq!(
            hooks.close_failures(),
            0,
            "CloseHandle must succeed for every owned handle"
        );
        let _ = fs::remove_file(marker);
    }

    #[cfg(windows)]
    #[test]
    fn create_job_object_failure_returns_without_a_handle() {
        let (result, hooks) = Supervisor::new_with_fault(windows::FaultPoint::CreateJobObject);
        let error = result
            .err()
            .expect("injected job creation failure must abort");
        assert!(error
            .to_string()
            .contains("injected CreateJobObjectW failure"));
        assert!(!hooks.job_was_created());
        assert_eq!(hooks.closed_handles(), 0);
        assert_eq!(hooks.close_failures(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn set_job_information_failure_closes_created_job_handle() {
        let (result, hooks) =
            Supervisor::new_with_fault(windows::FaultPoint::SetInformationJobObject);
        let error = result
            .err()
            .expect("injected Job configuration failure must abort");
        assert!(error
            .to_string()
            .contains("injected SetInformationJobObject failure"));
        assert!(hooks.job_was_created());
        assert_eq!(
            hooks.closed_handles(),
            1,
            "the unconfigured job handle must close"
        );
        assert_eq!(hooks.close_failures(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn assign_process_to_job_failure_kills_suspended_child_and_poisons_supervisor() {
        assert_injected_child_failure(
            windows::FaultPoint::AssignProcessToJobObject,
            "injected AssignProcessToJobObject failure",
        );
    }

    #[cfg(windows)]
    #[test]
    fn resume_thread_failure_terminates_job_before_returning() {
        assert_injected_child_failure(
            windows::FaultPoint::ResumeThread,
            "injected ResumeThread failure",
        );
    }

    #[cfg(windows)]
    #[test]
    fn failed_job_termination_falls_back_to_close_kill_on_close() {
        let _guard = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let marker = std::env::temp_dir().join(format!(
            "orion-supervisor-running-child-{}.txt",
            std::process::id()
        ));
        let _ = fs::remove_file(&marker);
        let restore = RestoreEnv::set("ORION_SUPERVISOR_EXECUTION_MARKER", marker.as_os_str());
        let (result, hooks) = Supervisor::new_with_fault(windows::FaultPoint::TerminateJobObject);
        let mut supervisor = result.expect("Job Object setup should succeed");
        let exe = std::env::current_exe().expect("test executable path");
        let pid = supervisor
            .spawn(
                ProcessSpec::new(exe.clone())
                    .arg("--ignored")
                    .arg("windows_test_must_not_run")
                    .arg("--nocapture")
                    .current_dir(std::env::temp_dir()),
            )
            .expect("running synthetic child should start inside the Job Object");
        drop(restore);
        let reaper = ChildReaper(pid);
        assert_eq!(
            hooks.closed_handles(),
            1,
            "the resumed child thread handle closes while Job and process handles remain owned"
        );

        let deadline = Instant::now() + Duration::from_secs(5);
        while !marker.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
        }
        assert!(
            marker.exists(),
            "synthetic process did not reach its running state"
        );

        let missing = std::env::temp_dir().join(format!("orion-no-such-child-{}.exe", pid));
        let error = supervisor.spawn(ProcessSpec::new(missing)).unwrap_err();
        assert!(error
            .to_string()
            .contains("injected TerminateJobObject failure"));
        assert!(error.to_string().contains("Job Object closed"));
        assert!(
            windows::wait_pid(pid, Duration::from_secs(5)).expect("query child after job close")
        );
        assert_eq!(
            hooks.closed_handles(),
            2,
            "closing the Job Object must retain the process handle until supervisor drop"
        );
        assert!(supervisor.spawn(ProcessSpec::new(exe)).is_err());

        drop(supervisor);
        assert_eq!(
            hooks.closed_handles(),
            3,
            "child thread, Job, and child process handles must close"
        );
        assert_eq!(hooks.close_failures(), 0);
        drop(reaper);
        let _ = fs::remove_file(marker);
    }

    #[cfg(windows)]
    #[test]
    fn failed_process_creation_does_not_leave_a_child() {
        let mut supervisor = Supervisor::new().expect("Job Object setup must succeed");
        let missing =
            std::env::temp_dir().join(format!("orion-no-such-child-{}.exe", std::process::id()));
        let error = supervisor.spawn(ProcessSpec::new(missing)).unwrap_err();
        assert!(error.to_string().contains("CreateProcessW"));
        supervisor
            .terminate_all()
            .expect("empty job should terminate cleanly");
        assert!(supervisor
            .spawn(ProcessSpec::new(std::env::current_exe().unwrap()))
            .is_err());
    }

    #[cfg(windows)]
    #[test]
    fn wait_for_exit_returns_child_exit_code() {
        let mut supervisor = Supervisor::new().expect("Job Object setup must succeed");
        let exe = std::env::current_exe().expect("test executable path");
        let pid = supervisor
            .spawn(
                ProcessSpec::new(exe)
                    .arg("--ignored")
                    .arg("windows_test_exit_with_code")
                    .arg("--nocapture")
                    .current_dir(std::env::temp_dir()),
            )
            .expect("contained exit-code helper should start");
        let reaper = ChildReaper(pid);

        assert_eq!(
            supervisor
                .wait_for_exit(pid, Duration::from_secs(5))
                .expect("wait for contained child"),
            Some(37)
        );
        assert_eq!(
            supervisor
                .wait_for_exit(pid, Duration::ZERO)
                .expect("read completed child's exit code"),
            Some(37)
        );
        assert!(supervisor
            .wait_for_exit(pid.wrapping_add(1), Duration::ZERO)
            .unwrap_err()
            .to_string()
            .contains("unknown supervised child PID"));

        drop(supervisor);
        drop(reaper);
    }

    #[cfg(windows)]
    #[test]
    fn wait_timeout_is_finite_and_shutdown_terminates_the_job() {
        let _guard = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let marker = std::env::temp_dir().join(format!(
            "orion-supervisor-wait-timeout-{}.txt",
            std::process::id()
        ));
        let _ = fs::remove_file(&marker);
        let restore = RestoreEnv::set("ORION_SUPERVISOR_EXECUTION_MARKER", marker.as_os_str());
        let mut supervisor = Supervisor::new().expect("Job Object setup must succeed");
        let exe = std::env::current_exe().expect("test executable path");
        let pid = supervisor
            .spawn(
                ProcessSpec::new(exe)
                    .arg("--ignored")
                    .arg("windows_test_must_not_run")
                    .arg("--nocapture")
                    .current_dir(std::env::temp_dir()),
            )
            .expect("contained blocking helper should start");
        drop(restore);
        let reaper = ChildReaper(pid);

        let deadline = Instant::now() + Duration::from_secs(5);
        while !marker.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
        }
        assert!(
            marker.exists(),
            "blocking helper did not reach its run state"
        );

        let started = Instant::now();
        assert_eq!(
            supervisor
                .wait_for_exit(pid, Duration::from_millis(75))
                .expect("bounded wait should succeed"),
            None,
            "a still-running process must report timeout"
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "requested wait timeout must not become an unbounded wait"
        );

        let shutdown_started = Instant::now();
        supervisor
            .terminate_all()
            .expect("Job Object shutdown should finish within its fixed bound");
        assert!(
            shutdown_started.elapsed() < Duration::from_secs(12),
            "shutdown exceeded the 10 second Job Object bound plus scheduling margin"
        );
        assert!(supervisor
            .wait_for_exit(pid, Duration::ZERO)
            .expect("read terminated child's exit code")
            .is_some());
        assert!(windows::wait_pid(pid, Duration::from_secs(5)).expect("confirm process exit"));
        assert!(supervisor
            .spawn(ProcessSpec::new(std::env::current_exe().unwrap()))
            .is_err());

        drop(supervisor);
        drop(reaper);
        let _ = fs::remove_file(marker);
    }

    #[cfg(windows)]
    #[test]
    fn isolated_environment_filters_inherited_values_and_preserves_unicode() {
        let _guard = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let report = std::env::temp_dir().join(format!(
            "orion-supervisor-env-report-{}.txt",
            std::process::id()
        ));
        let _ = fs::remove_file(&report);
        let secret = RestoreEnv::set(
            "ORION_SUPERVISOR_INHERITED_SECRET",
            std::ffi::OsStr::new("must-not-cross-boundary"),
        );
        let allowed = RestoreEnv::set(
            "ORION_SUPERVISOR_ALLOWED_VALUE",
            std::ffi::OsStr::new("explicitly-allowed"),
        );

        let mut supervisor = Supervisor::new().expect("Job Object setup must succeed");
        let exe = std::env::current_exe().expect("test executable path");
        let pid = supervisor
            .spawn(
                ProcessSpec::new(exe)
                    .arg("--ignored")
                    .arg("windows_test_report_environment")
                    .arg("--nocapture")
                    .current_dir(std::env::temp_dir())
                    .allow_env("ORION_SUPERVISOR_ALLOWED_VALUE")
                    .env("ORION_SUPERVISOR_ENV_REPORT", report.as_os_str())
                    .env("zulu", "last-ascii")
                    .env("ALPHA", "first-ascii")
                    .env("ОРИОН_ПЕРЕМЕННАЯ", "значение 🔐"),
            )
            .expect("isolated environment child should start");
        assert_eq!(
            supervisor
                .wait_for_exit(pid, Duration::from_secs(5))
                .expect("wait for environment helper"),
            Some(0)
        );
        let output = fs::read_to_string(&report).expect("read child's environment report");
        assert!(output.contains("ORION_SUPERVISOR_ALLOWED_VALUE=explicitly-allowed"));
        assert!(output.contains("ALPHA=first-ascii"));
        assert!(output.contains("zulu=last-ascii"));
        assert!(output.contains("ОРИОН_ПЕРЕМЕННАЯ=значение 🔐"));
        assert!(!output.contains("ORION_SUPERVISOR_INHERITED_SECRET"));
        assert!(!output.contains("must-not-cross-boundary"));
        assert!(
            output.find("ALPHA=").unwrap() < output.find("zulu=").unwrap(),
            "isolated variables must be passed in deterministic case-insensitive order"
        );

        drop(supervisor);
        drop(allowed);
        drop(secret);
        let _ = fs::remove_file(report);
    }

    #[cfg(windows)]
    #[test]
    fn isolated_environment_rejects_conflicting_or_malformed_variables_without_values() {
        assert!(matches!(
            ProcessSpec::new("unused.exe").environment,
            EnvironmentPolicy::Inherit
        ));
        assert!(matches!(
            ProcessSpec::new("unused.exe")
                .isolated_environment()
                .environment,
            EnvironmentPolicy::Isolated { .. }
        ));
        assert!(matches!(
            ProcessSpec::new("unused.exe")
                .env("ONE", "two")
                .inherit_environment()
                .environment,
            EnvironmentPolicy::Inherit
        ));

        let duplicate = EnvironmentPolicy::Isolated {
            allowlist: Vec::new(),
            values: vec![
                ("ORION_CONFLICT".into(), "sensitive-one".into()),
                ("orion_conflict".into(), "sensitive-two".into()),
            ],
        };
        let error = windows::build_environment_block(&duplicate).unwrap_err();
        assert!(error.to_string().contains("duplicate isolated environment"));
        assert!(!error.to_string().contains("sensitive-one"));
        assert!(!error.to_string().contains("sensitive-two"));

        let malformed_name = EnvironmentPolicy::Isolated {
            allowlist: Vec::new(),
            values: vec![("BAD=NAME".into(), "secret-value".into())],
        };
        let error = windows::build_environment_block(&malformed_name).unwrap_err();
        assert!(error
            .to_string()
            .contains("invalid environment variable name"));
        assert!(!error.to_string().contains("secret-value"));

        let nul_value = EnvironmentPolicy::Isolated {
            allowlist: Vec::new(),
            values: vec![("ORION_VALUE".into(), OsString::from("secret\0value"))],
        };
        let error = windows::build_environment_block(&nul_value).unwrap_err();
        assert!(error.to_string().contains("contains NUL"));
        assert!(!error.to_string().contains("secret"));

        // An explicit value intentionally overrides the same allowlisted
        // variable, using Windows' case-insensitive name semantics.
        let override_policy = EnvironmentPolicy::Isolated {
            allowlist: vec!["ORION_SUPERVISOR_ALLOWED_VALUE".into()],
            values: vec![("orion_supervisor_allowed_value".into(), "override".into())],
        };
        let block = windows::build_environment_block(&override_policy)
            .expect("allowlist override should be valid")
            .expect("isolated policy must create a block");
        let block = String::from_utf16_lossy(&block);
        assert!(block.contains("orion_supervisor_allowed_value=override"));
        assert!(!block.contains("explicitly-allowed"));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_relative_program_before_process_creation() {
        let mut supervisor = Supervisor::new().expect("Job Object setup must succeed");
        let error = supervisor
            .spawn(ProcessSpec::new("relative-child.exe"))
            .unwrap_err();
        assert!(error.to_string().contains("must be absolute"));
        supervisor
            .terminate_all()
            .expect("empty job should terminate cleanly");
    }

    #[cfg(windows)]
    #[test]
    fn closing_supervisor_terminates_child_and_grandchild() {
        let _guard = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let pid_file =
            std::env::temp_dir().join(format!("orion-job-tree-{}.txt", std::process::id()));
        let _ = fs::remove_file(&pid_file);
        let old = std::env::var_os("ORION_SUPERVISOR_TEST_PID_FILE");
        std::env::set_var("ORION_SUPERVISOR_TEST_PID_FILE", &pid_file);
        let mut supervisor = Supervisor::new().expect("Job Object setup must succeed");
        let exe = std::env::current_exe().expect("test executable path");
        let pid = supervisor
            .spawn(
                ProcessSpec::new(exe)
                    .arg("--ignored")
                    // Substring filters survive whether this file is the test
                    // crate root (`tests::...`) or compiled as `supervisor::tests::...`.
                    .arg("windows_test_parent_helper")
                    .arg("--nocapture")
                    .current_dir(std::env::temp_dir()),
            )
            .expect("suspended child should be assigned before it runs");
        if let Some(value) = old {
            std::env::set_var("ORION_SUPERVISOR_TEST_PID_FILE", value);
        } else {
            std::env::remove_var("ORION_SUPERVISOR_TEST_PID_FILE");
        }

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut pids = Vec::new();
        while Instant::now() < deadline {
            if let Ok(text) = fs::read_to_string(&pid_file) {
                pids = text
                    .lines()
                    .filter_map(|line| line.parse::<u32>().ok())
                    .collect();
                if pids.len() >= 2 {
                    break;
                }
            }
            thread::sleep(Duration::from_millis(25));
        }
        assert_eq!(
            pids.len(),
            2,
            "child and grandchild must report their PIDs before cleanup"
        );
        assert!(
            !windows::process_is_signaled(pid).expect("query supervised child"),
            "supervised child should be alive before cleanup"
        );
        for child_pid in &pids {
            assert!(
                !windows::process_is_signaled(*child_pid).expect("query reported descendant"),
                "reported descendant should be alive before cleanup"
            );
        }

        drop(supervisor);
        for child_pid in pids {
            assert!(
                windows::wait_pid(child_pid, Duration::from_secs(10)).expect("wait for descendant"),
                "Job Object left descendant {child_pid} alive"
            );
        }
        assert!(
            windows::wait_pid(pid, Duration::from_secs(10)).expect("wait for direct child"),
            "Job Object left direct child {pid} alive"
        );
        let _ = fs::remove_file(pid_file);
    }

    /// Spawned as a test-binary child with `--ignored`; it writes its PID and
    /// starts a grandchild, which must inherit Job Object membership.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_test_parent_helper() {
        let pid_file = std::env::var_os("ORION_SUPERVISOR_TEST_PID_FILE").expect("pid file env");
        use std::io::Write;
        let mut output = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&pid_file)
            .expect("open pid file");
        writeln!(output, "{}", std::process::id()).expect("write child pid");
        drop(output);
        let exe = std::env::current_exe().expect("test executable path");
        let mut child = std::process::Command::new(exe)
            .args(["--ignored", "windows_test_grandchild_helper", "--nocapture"])
            .spawn()
            .expect("start grandchild");
        let _ = child.wait();
    }

    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_test_grandchild_helper() {
        let pid_file = std::env::var_os("ORION_SUPERVISOR_TEST_PID_FILE").expect("pid file env");
        use std::io::Write;
        let mut output = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(pid_file)
            .expect("open pid file");
        writeln!(output, "{}", std::process::id()).expect("write grandchild pid");
        loop {
            thread::sleep(Duration::from_secs(60));
        }
    }

    /// A suspended helper used by fault injection. If a failed path resumes it,
    /// it writes a marker and blocks until the test reaper terminates its PID.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_test_must_not_run() {
        let marker =
            std::env::var_os("ORION_SUPERVISOR_EXECUTION_MARKER").expect("execution marker env");
        fs::write(marker, std::process::id().to_string()).expect("write execution marker");
        loop {
            thread::sleep(Duration::from_secs(60));
        }
    }

    /// Helper process used to verify the supervisor returns the real exit code.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_test_exit_with_code() {
        std::process::exit(37);
    }

    /// Helper that records its effective environment for isolated-mode tests.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_test_report_environment() {
        let report = std::env::var_os("ORION_SUPERVISOR_ENV_REPORT")
            .expect("report path must be supplied explicitly");
        let mut variables: Vec<_> = std::env::vars_os().collect();
        variables.sort_by_key(|(name, _)| name.to_string_lossy().to_lowercase());
        let mut output = fs::File::create(report).expect("create environment report");
        use std::io::Write;
        for (name, value) in variables {
            writeln!(
                output,
                "{}={}",
                name.to_string_lossy(),
                value.to_string_lossy()
            )
            .expect("write environment report");
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn refuses_to_claim_containment_on_non_windows() {
        assert!(Supervisor::new()
            .err()
            .unwrap()
            .to_string()
            .contains("requires Windows"));
    }
}
