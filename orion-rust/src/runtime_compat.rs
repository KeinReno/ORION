//! Path and packaged PostgreSQL compatibility with the classic Windows launcher.
//!
//! PostgreSQL's Windows tools require ASCII paths. The classic launcher keeps
//! the requested profile for application logs, but moves its database cluster
//! to a per-user `%ProgramData%\\ORION-Rust\\data-<tag>` directory when that
//! profile contains non-ASCII characters. It similarly mirrors bundled PG
//! binaries to a versioned ASCII path when the install path is non-ASCII.

use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const COPY_MARKER: &str = ".orion-pg-copy";
const STALE_COPY_RETENTION: Duration = Duration::from_secs(48 * 60 * 60);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimePaths {
    /// Requested profile, retained for logs and shell-facing status files.
    pub requested_data_dir: PathBuf,
    /// ASCII profile actually used for PostgreSQL and runtime secrets.
    pub effective_data_dir: PathBuf,
    /// PostgreSQL files shipped inside the installed runtime.
    pub packaged_pg_dir: PathBuf,
    /// PostgreSQL directory used to start `initdb` and `pg_ctl`.
    pub effective_pg_dir: PathBuf,
    /// Root that owns generated fallback paths and the per-user fallback.
    pub fallback_root: PathBuf,
    /// Whether the packaged PostgreSQL directory must be copied.
    pub mirror_pg: bool,
}

/// Mirror launcher.cjs's ASCII fallback rules. `user_identity` must be the
/// Windows `USERDOMAIN/USERNAME` pair (or the exact account-name fallback
/// used by the launcher) so both implementations choose the same profile.
pub fn resolve_runtime_paths(
    requested_data_dir: &Path,
    packaged_runtime: &Path,
    app_version: &str,
    program_data: &Path,
    user_identity: &str,
) -> Result<RuntimePaths, String> {
    let ordinary_data = ordinary_windows_path(requested_data_dir);
    let ordinary_runtime = ordinary_windows_path(packaged_runtime);
    let ordinary_program_data = ordinary_windows_path(program_data);
    if !ordinary_data.is_absolute()
        || !ordinary_runtime.is_absolute()
        || !ordinary_program_data.is_absolute()
    {
        return Err("Пути профиля, runtime и ProgramData должны быть абсолютными".to_owned());
    }
    if user_identity.is_empty() {
        return Err("Не удалось определить учётную запись Windows для ASCII-профиля".to_owned());
    }

    let fallback_root = ordinary_program_data.join("ORION-Rust");
    let effective_data_dir = if path_is_ascii(&ordinary_data) {
        ordinary_data.clone()
    } else {
        fallback_root.join(format!("data-{}", user_tag(user_identity)))
    };
    let packaged_pg_dir = ordinary_runtime.join("postgres");
    let mirror_pg = !path_is_ascii(&packaged_pg_dir);
    let effective_pg_dir = if mirror_pg {
        fallback_root.join(format!("pg-{}", sanitize_version(app_version)))
    } else {
        packaged_pg_dir.clone()
    };
    if !path_is_ascii(&effective_data_dir) || !path_is_ascii(&effective_pg_dir) {
        return Err("ASCII fallback path still contains non-ASCII characters".to_owned());
    }

    Ok(RuntimePaths {
        requested_data_dir: ordinary_data,
        effective_data_dir,
        packaged_pg_dir,
        effective_pg_dir,
        fallback_root,
        mirror_pg,
    })
}

/// Return a usable PostgreSQL directory. A valid version marker is reused.
/// On refresh, the previous generated copy is preserved under a unique stale
/// name; runtime code never recursively deletes a pre-existing user path.
pub fn prepare_postgres_binaries(paths: &RuntimePaths, version: &str) -> Result<PathBuf, String> {
    if !paths.mirror_pg {
        verify_pg_binaries(&paths.effective_pg_dir)?;
        return Ok(paths.effective_pg_dir.clone());
    }
    validate_generated_target(paths)?;
    ensure_no_link_components(&paths.effective_pg_dir)?;
    if marker_matches(&paths.effective_pg_dir, version)? {
        verify_pg_binaries(&paths.effective_pg_dir)?;
        prune_stale_copies(&paths.effective_pg_dir);
        return Ok(paths.effective_pg_dir.clone());
    }

    ensure_no_link_components(&paths.fallback_root)?;
    fs::create_dir_all(&paths.fallback_root)
        .map_err(|error| format!("Не удалось создать ASCII-каталог PostgreSQL: {error}"))?;
    ensure_no_link_components(&paths.fallback_root)?;

    let stage = unique_sibling(&paths.effective_pg_dir, "stage");
    fs::create_dir(&stage)
        .map_err(|error| format!("Не удалось подготовить копию PostgreSQL: {error}"))?;
    let staged_result = (|| {
        copy_tree_without_links(&paths.packaged_pg_dir, &stage)?;
        verify_pg_binaries(&stage)?;
        fs::write(stage.join(COPY_MARKER), version)
            .map_err(|error| format!("Не удалось отметить копию PostgreSQL: {error}"))?;
        Ok::<(), String>(())
    })();
    if let Err(error) = staged_result {
        let _ = fs::remove_dir_all(&stage);
        return Err(error);
    }

    let stale = if paths.effective_pg_dir.exists() {
        let stale = unique_sibling(&paths.effective_pg_dir, "stale");
        fs::rename(&paths.effective_pg_dir, &stale)
            .map_err(|error| format!("Не удалось сохранить прежнюю копию PostgreSQL: {error}"))?;
        Some(stale)
    } else {
        None
    };
    if let Err(error) = fs::rename(&stage, &paths.effective_pg_dir) {
        let rollback_error = stale
            .as_ref()
            .and_then(|stale| fs::rename(stale, &paths.effective_pg_dir).err());
        let _ = fs::remove_dir_all(&stage);
        let mut message = format!("Could not publish PostgreSQL mirror: {error}");
        if let Some(rollback_error) = rollback_error {
            message.push_str(&format!(
                "; could not restore the previous mirror: {rollback_error}"
            ));
        }
        return Err(message);
    }
    verify_pg_binaries(&paths.effective_pg_dir)?;
    prune_stale_copies(&paths.effective_pg_dir);
    Ok(paths.effective_pg_dir.clone())
}

fn prune_stale_copies(target: &Path) {
    let (Some(parent), Some(name)) = (target.parent(), target.file_name().and_then(OsStr::to_str))
    else {
        return;
    };
    let Ok(cutoff) = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.saturating_sub(STALE_COPY_RETENTION).as_nanos())
    else {
        return;
    };
    let stale_prefix = format!("{name}-stale-");
    let stage_prefix = format!("{name}-stage-");
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!("Could not list stale PostgreSQL mirrors: {error}");
            return;
        }
    };
    for entry in entries {
        let result = entry.and_then(|entry| {
            let filename = entry.file_name();
            let Some(name) = filename.to_str() else {
                return Ok(());
            };
            let stage = name.starts_with(&stage_prefix);
            let generation = name
                .strip_prefix(&stage_prefix)
                .or_else(|| name.strip_prefix(&stale_prefix))
                .and_then(|suffix| suffix.split_once('-'))
                .and_then(|(pid, stamp)| {
                    pid.parse::<u32>().ok()?;
                    stamp.parse::<u128>().ok()
                });
            if generation.is_some_and(|stamp| stamp < cutoff)
                && is_plain_directory(&entry.path())?
                && (stage
                    || entry
                        .path()
                        .join(COPY_MARKER)
                        .symlink_metadata()
                        .is_ok_and(|m| m.is_file()))
            {
                fs::remove_dir_all(entry.path())?;
            }
            Ok(())
        });
        if let Err(error) = result {
            eprintln!("Could not prune a stale PostgreSQL mirror: {error}");
        }
    }
}

fn is_plain_directory(path: &Path) -> io::Result<bool> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(false);
        }
    }
    Ok(metadata.file_type().is_dir())
}

pub fn path_is_ascii(path: &Path) -> bool {
    path.as_os_str().to_string_lossy().is_ascii()
}

/// Strip only the Windows extended-length prefix used by Tauri resource_dir.
pub fn ordinary_windows_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.as_os_str().to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            if rest.as_bytes().get(1) == Some(&b':') {
                return PathBuf::from(rest);
            }
        }
    }
    path.to_path_buf()
}

fn user_tag(user_identity: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(user_identity.to_lowercase().as_bytes());
    let digest = hasher.finalize();
    digest[..5]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sanitize_version(version: &str) -> String {
    let safe: String = version
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        "unknown".to_owned()
    } else {
        safe
    }
}

fn validate_generated_target(paths: &RuntimePaths) -> Result<(), String> {
    let root = normalized_lexical(&paths.fallback_root);
    let target = normalized_lexical(&paths.effective_pg_dir);
    if target.parent() != Some(root.as_path()) || !target.starts_with(&root) {
        return Err("Отказ от изменения каталога PostgreSQL вне ORION-Rust fallback".to_owned());
    }
    Ok(())
}

fn normalized_lexical(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

fn marker_matches(target: &Path, version: &str) -> Result<bool, String> {
    let marker = target.join(COPY_MARKER);
    match fs::read_to_string(marker) {
        Ok(value) => Ok(value == version),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Не удалось проверить версию копии PostgreSQL: {error}"
        )),
    }
}

fn copy_tree_without_links(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Не удалось прочитать упакованные файлы PostgreSQL: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Путь упакованного PostgreSQL не является обычным каталогом".to_owned());
    }
    for entry in
        fs::read_dir(source).map_err(|error| format!("Не удалось прочитать PostgreSQL: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Не удалось прочитать содержимое PostgreSQL: {error}"))?;
        let kind = entry
            .file_type()
            .map_err(|error| format!("Не удалось проверить файл PostgreSQL: {error}"))?;
        let destination = target.join(entry.file_name());
        if kind.is_symlink() {
            return Err("В упакованных файлах PostgreSQL обнаружена ссылка".to_owned());
        } else if kind.is_dir() {
            fs::create_dir(&destination)
                .map_err(|error| format!("Не удалось создать каталог PostgreSQL: {error}"))?;
            copy_tree_without_links(&entry.path(), &destination)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), destination)
                .map_err(|error| format!("Не удалось скопировать PostgreSQL: {error}"))?;
        } else {
            return Err(
                "В упакованных файлах PostgreSQL найден неподдерживаемый объект".to_owned(),
            );
        }
    }
    Ok(())
}

fn verify_pg_binaries(directory: &Path) -> Result<(), String> {
    for name in ["bin/initdb.exe", "bin/pg_ctl.exe", "bin/postgres.exe"] {
        let path = directory.join(name);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("В каталоге PostgreSQL нет {name}: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!("Файл PostgreSQL {name} должен быть обычным файлом"));
        }
        if !path_is_ascii(&path) {
            return Err(format!(
                "Путь к {name} PostgreSQL должен содержать только ASCII"
            ));
        }
    }
    Ok(())
}

fn ensure_no_link_components(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Отказ от использования ссылки в пути PostgreSQL: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Не удалось проверить путь PostgreSQL: {error}")),
        }
    }
    Ok(())
}

fn unique_sibling(target: &Path, label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let suffix = format!("{label}-{}-{stamp}", std::process::id());
    let name = target.file_name().unwrap_or_else(|| OsStr::new("postgres"));
    target.with_file_name(format!("{}-{suffix}", name.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn temp(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "orion-runtime-compat-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("temporary test root");
        path
    }

    fn fixture_pg(runtime: &Path) -> PathBuf {
        let source = runtime.join("postgres");
        fs::create_dir_all(source.join("bin")).expect("source binary directory");
        for name in ["initdb.exe", "pg_ctl.exe", "postgres.exe"] {
            fs::write(source.join("bin").join(name), name).expect("fixture binary");
        }
        source
    }

    #[test]
    fn ascii_paths_stay_in_packaged_profile_and_runtime() {
        let root = temp("ascii");
        let runtime = root.join("runtime");
        let source = fixture_pg(&runtime);
        let paths = resolve_runtime_paths(
            &root.join("profile"),
            &runtime,
            "1.2.3",
            &root.join("ProgramData"),
            "DOMAIN/reno",
        )
        .expect("resolve paths");
        assert_eq!(paths.effective_data_dir, root.join("profile"));
        assert_eq!(paths.effective_pg_dir, source);
        assert!(!paths.mirror_pg);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn non_ascii_profile_uses_classic_per_user_program_data_fallback() {
        let root = temp("кириллица");
        let pd = std::env::temp_dir().join(format!("orion-compat-pd-{}-data", std::process::id()));
        let runtime = root.join("runtime");
        fixture_pg(&runtime);
        let program_data = pd.clone();
        let paths = resolve_runtime_paths(
            &root.join("профиль"),
            &runtime,
            "1.2.3",
            &program_data,
            "DOMAIN/Reno",
        )
        .expect("resolve paths");
        assert_eq!(
            paths.effective_data_dir,
            program_data
                .join("ORION-Rust")
                .join(format!("data-{}", user_tag("DOMAIN/Reno")))
        );
        assert!(path_is_ascii(&paths.effective_data_dir));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn non_ascii_install_mirrors_binaries_and_preserves_old_copy_on_refresh() {
        let root = temp("кириллица-runtime");
        let pd =
            std::env::temp_dir().join(format!("orion-compat-pd-{}-refresh", std::process::id()));
        let runtime = root.join("установка");
        let source = fixture_pg(&runtime);
        let paths =
            resolve_runtime_paths(&root.join("profile"), &runtime, "1.2.3", &pd, "DOMAIN/Reno")
                .expect("resolve paths");
        assert!(paths.mirror_pg);
        let target = prepare_postgres_binaries(&paths, "1.2.3").expect("copy PG");
        assert_eq!(
            fs::read(target.join("bin/pg_ctl.exe")).expect("read binary"),
            b"pg_ctl.exe"
        );
        assert!(marker_matches(&target, "1.2.3").expect("marker"));
        fs::write(source.join("bin/pg_ctl.exe"), b"new-version").expect("update source fixture");
        prepare_postgres_binaries(&paths, "1.2.4").expect("refresh PG");
        assert_eq!(
            fs::read(target.join("bin/pg_ctl.exe")).expect("read refreshed binary"),
            b"new-version"
        );
        let stale_count = fs::read_dir(target.parent().expect("fallback parent"))
            .expect("fallback listing")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("stale-"))
            .count();
        assert_eq!(stale_count, 1, "old copy should be retained for recovery");

        let expired_name = format!(
            "{}-stale-42-1",
            target.file_name().unwrap().to_string_lossy()
        );
        let expired = target.with_file_name(expired_name);
        fs::create_dir(&expired).unwrap();
        fs::write(expired.join(COPY_MARKER), "old").unwrap();
        let unrelated = target.with_file_name(format!(
            "{}-stale-43-1",
            target.file_name().unwrap().to_string_lossy()
        ));
        fs::create_dir(&unrelated).unwrap();
        let interrupted_stage = target.with_file_name(format!(
            "{}-stage-44-1",
            target.file_name().unwrap().to_string_lossy()
        ));
        fs::create_dir(&interrupted_stage).unwrap();
        prepare_postgres_binaries(&paths, "1.2.4").unwrap();
        assert!(!interrupted_stage.exists());
        assert!(!expired.exists());
        assert!(unrelated.is_dir());
        fs::remove_dir_all(root).expect("cleanup");
        fs::remove_dir_all(pd).expect("cleanup fallback");
    }

    #[test]
    fn refuses_to_replace_target_outside_generated_fallback() {
        let root = temp("target-guard");
        let runtime = root.join("runtime");
        let source = fixture_pg(&runtime);
        let pd = std::env::temp_dir().join(format!("orion-compat-pd-{}-guard", std::process::id()));
        let mut paths =
            resolve_runtime_paths(&root.join("профиль"), &runtime, "1", &pd, "DOMAIN/Reno")
                .expect("resolve paths");
        paths.effective_pg_dir = root.join("user-files");
        assert!(prepare_postgres_binaries(&paths, "1").is_err());
        assert!(source.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_links_inside_packaged_postgres_tree() {
        let root = temp("linked-source");
        let pd = std::env::temp_dir().join(format!("orion-compat-pd-{}-links", std::process::id()));
        let runtime = root.join("кириллическая-установка");
        let source = fixture_pg(&runtime);
        let link = source.join("external-link");
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(root.join("outside"), &link).is_err() {
            // Developer mode or elevated privileges may be required on Windows.
            fs::remove_dir_all(root).expect("cleanup");
            return;
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(root.join("outside"), &link).expect("create symlink");
        fs::write(root.join("outside"), b"outside").expect("outside target");
        let paths = resolve_runtime_paths(&root.join("profile"), &runtime, "1", &pd, "DOMAIN/Reno")
            .expect("resolve paths");
        assert!(prepare_postgres_binaries(&paths, "1")
            .unwrap_err()
            .contains("ссылка"));
        assert!(!paths.effective_pg_dir.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
