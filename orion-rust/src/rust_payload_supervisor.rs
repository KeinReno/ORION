//! Adapter between the installed payload selector and API supervisor.
//!
//! Registered in the production path: `lifecycle.rs` primes the adapter
//! before database work, and `SystemApiBackend` reuses it for trial ACK and
//! rollback transitions. Selection builds a complete API command; it does
//! not launch a process. The supervisor owns the ACK/health/listener gate
//! and calls `settle_trial(true)` only after that gate.

use crate::rust_api_supervisor::ApiCommand;
use crate::rust_payload::{
    acknowledge_installed_trial, rollback_installed_trial, select_installed_payload,
    BuiltinPayloadCrypto, InstalledSelection, PayloadError,
};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum AdapterError {
    Payload(PayloadError),
    InvalidRuntime,
    InvalidCommand,
    NoSelectedTrial,
    SettleRejected,
}

impl From<PayloadError> for AdapterError {
    fn from(value: PayloadError) -> Self {
        Self::Payload(value)
    }
}

impl std::fmt::Display for AdapterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Payload(error) => write!(f, "payload selection failed: {}", error.message()),
            Self::InvalidRuntime => f.write_str("selected runtime is incomplete"),
            Self::InvalidCommand => f.write_str("API command has no unique entrypoint argument"),
            Self::NoSelectedTrial => f.write_str("there is no selected payload trial to settle"),
            Self::SettleRejected => f.write_str("payload state rejected trial settlement"),
        }
    }
}

impl std::error::Error for AdapterError {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildFile {
    tag: String,
    #[serde(default)]
    commit: String,
    #[serde(default)]
    built_at: String,
}

#[derive(Deserialize)]
struct ApiPackage {
    version: String,
}

/// State adapter for one supervisor run. Keep `public_key_pem` absent when a
/// runtime has no update key: baseline selection remains valid, while any
/// pending/active payload requiring verification falls back through payload.cjs
/// compatible state transitions.
pub struct PayloadSupervisorAdapter {
    runtime_root: PathBuf,
    data_dir: PathBuf,
    public_key_pem: Option<Vec<u8>>,
    entrypoint_index: usize,
    selected: Option<InstalledSelection>,
}

impl PayloadSupervisorAdapter {
    pub fn new(
        runtime_root: impl Into<PathBuf>,
        data_dir: impl Into<PathBuf>,
        public_key_pem: Option<Vec<u8>>,
        entrypoint_index: usize,
    ) -> Self {
        Self {
            runtime_root: runtime_root.into(),
            data_dir: data_dir.into(),
            public_key_pem,
            entrypoint_index,
            selected: None,
        }
    }

    /// Select and verify an installed version, then return the full command for
    /// that version. `entrypoint_index` explicitly identifies the Node main-file
    /// argument so the adapter never guesses which argument to replace.
    pub fn select_application(
        &mut self,
        template: &ApiCommand,
    ) -> Result<ApiCommand, AdapterError> {
        let crypto = BuiltinPayloadCrypto;
        let selection = select_installed_payload(
            &self.runtime_root,
            &self.data_dir,
            self.public_key_pem.as_deref(),
            &crypto,
        )?;
        let command = command_for_selection(template, &selection, self.entrypoint_index)?;
        self.selected = Some(selection);
        Ok(command)
    }

    /// Called by the API supervisor after its readiness gate. On success the
    /// gate must already have checked exact UI ACK, HTTP success, database=ok,
    /// and (on Windows) listener ownership by the API Job.
    pub fn settle_trial(&mut self, succeeded: bool) -> Result<(), AdapterError> {
        let selection = self
            .selected
            .as_ref()
            .ok_or(AdapterError::NoSelectedTrial)?;
        if !selection.trial {
            return Err(AdapterError::NoSelectedTrial);
        }
        let settled = if succeeded {
            acknowledge_installed_trial(
                &self.data_dir,
                Some(&build_tag(&selection.root)?),
                true,
                true,
            )?
        } else {
            rollback_installed_trial(&self.data_dir)?
        };
        if !settled {
            return Err(AdapterError::SettleRejected);
        }
        if succeeded {
            if let Some(selected) = self.selected.as_mut() {
                selected.trial = false;
            }
        }
        Ok(())
    }
}

/// Convert the verified installed selection into the process command consumed
/// by `rust_api_supervisor`. `program`, args other than the explicit entrypoint,
/// base environment, and network/profile settings remain from the immutable
/// launcher template; executable path, cwd, web assets and build tag follow the
/// selected application root.
fn command_for_selection(
    template: &ApiCommand,
    selection: &InstalledSelection,
    entrypoint_index: usize,
) -> Result<ApiCommand, AdapterError> {
    let api = selection.root.join("api");
    let main = api.join("dist").join("main.js");
    let web = selection.root.join("web");
    if !main.is_file() || !api.join("package.json").is_file() || !web.join("index.html").is_file() {
        return Err(AdapterError::InvalidRuntime);
    }
    let mut command = template.clone();
    let arg = command
        .args
        .get_mut(entrypoint_index)
        .ok_or(AdapterError::InvalidCommand)?;
    *arg = main.into_os_string();
    command.cwd = api.clone();
    let build = read_build(&selection.root)?;
    command.build_tag = build.tag.clone();
    let package: ApiPackage = serde_json::from_slice(
        &fs::read(api.join("package.json")).map_err(|_| AdapterError::InvalidRuntime)?,
    )
    .map_err(|_| AdapterError::InvalidRuntime)?;
    set_env(&mut command, "APP_VERSION", package.version);
    set_env(&mut command, "ORION_BUILD_TAG", build.tag);
    set_env(&mut command, "ORION_BUILD_COMMIT", build.commit);
    set_env(&mut command, "ORION_BUILD_TIME", build.built_at);
    set_env(
        &mut command,
        "ORION_API_PACKAGE_JSON",
        api.join("package.json").display().to_string(),
    );
    command.web_dist = Some(web);
    command.trial = selection.trial;
    command.payload_failure = if selection.failed.is_some() {
        "Обновление не прошло проверку запуска. Восстановлена предыдущая версия приложения.".into()
    } else {
        String::new()
    };
    Ok(command)
}

fn build_tag(root: &Path) -> Result<String, AdapterError> {
    let build = read_build(root)?;
    if !crate::rust_payload::tag_is_valid(&build.tag) {
        return Err(AdapterError::InvalidRuntime);
    }
    Ok(build.tag)
}

fn read_build(root: &Path) -> Result<BuildFile, AdapterError> {
    let bytes = fs::read(root.join("build.json")).map_err(|_| AdapterError::InvalidRuntime)?;
    serde_json::from_slice(&bytes).map_err(|_| AdapterError::InvalidRuntime)
}

fn set_env(command: &mut ApiCommand, name: &str, value: String) {
    let folded = name.to_ascii_lowercase();
    command
        .base_env
        .retain(|key, _| key.to_string_lossy().to_ascii_lowercase() != folded);
    command.base_env.insert(name.into(), value.into());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("orion-payload-adapter-{stamp}"));
        fs::create_dir_all(root.join("api/dist")).unwrap();
        fs::create_dir_all(root.join("web")).unwrap();
        fs::write(root.join("api/dist/main.js"), "").unwrap();
        fs::write(root.join("api/package.json"), r#"{"version":"1.2.3"}"#).unwrap();
        fs::write(root.join("web/index.html"), "").unwrap();
        fs::write(root.join("build.json"), r#"{"tag":"v1.2.3"}"#).unwrap();
        root
    }

    #[test]
    fn command_switches_all_application_paths_and_preserves_launcher_environment() {
        let root = temp();
        let mut template = ApiCommand::new("node.exe", "old/api", "data", 4400);
        template.args = vec![OsString::from("old/api/dist/main.js")];
        template
            .base_env
            .insert("DATABASE_URL".into(), "preserve".into());
        let selection = InstalledSelection {
            root: root.clone(),
            id: Some("v1.2.3-abcdef0123456789".into()),
            trial: true,
            failed: None,
        };
        let command = command_for_selection(&template, &selection, 0).unwrap();
        assert_eq!(command.program, template.program);
        assert_eq!(command.cwd, root.join("api"));
        assert_eq!(
            command.args[0],
            root.join("api")
                .join("dist")
                .join("main.js")
                .into_os_string()
        );
        assert_eq!(
            command.web_dist.as_deref(),
            Some(root.join("web").as_path())
        );
        assert_eq!(command.build_tag, "v1.2.3");
        assert!(command.trial);
        assert_eq!(
            command.base_env.get(std::ffi::OsStr::new("DATABASE_URL")),
            Some(&std::ffi::OsString::from("preserve"))
        );
        assert_eq!(
            command.base_env.get(std::ffi::OsStr::new("APP_VERSION")),
            Some(&std::ffi::OsString::from("1.2.3"))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_entrypoint_or_missing_assets_fail_closed() {
        let root = temp();
        let template = ApiCommand::new("node.exe", "old/api", "data", 4400);
        let selection = InstalledSelection {
            root: root.clone(),
            id: None,
            trial: false,
            failed: None,
        };
        assert!(matches!(
            command_for_selection(&template, &selection, 0),
            Err(AdapterError::InvalidCommand)
        ));
        fs::remove_file(root.join("web/index.html")).unwrap();
        let mut template = template;
        template.args.push(OsString::from("old/api/dist/main.js"));
        assert!(matches!(
            command_for_selection(&template, &selection, 0),
            Err(AdapterError::InvalidRuntime)
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
