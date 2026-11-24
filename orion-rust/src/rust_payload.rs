//! Rust-side model of the ORION payload protocol.
//!
//! This module is registered from `lib.rs` and is part of the production
//! `supervise-direct` path: `PayloadSupervisorAdapter` selects the installed
//! version before migrations and settles trials after the readiness gate.
//! Cryptography is injectable so tests cannot claim placeholder security.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const MAX_MANIFEST_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_PAYLOAD_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_FILES: usize = 100_000;

const REQUIRED_FILES: [&str; 5] = [
    "api/dist/main.js",
    "api/package.json",
    "api/prisma/schema.prisma",
    "web/index.html",
    "build.json",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadManifest {
    pub protocol: u32,
    pub platform: String,
    pub base_tag: String,
    pub shell_hash: String,
    pub database_hash: String,
    pub tag: String,
    pub files: Vec<PayloadFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayloadEnvelope {
    pub manifest: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseInfo {
    pub protocol: u32,
    pub platform: String,
    pub base_tag: String,
    pub shell_hash: String,
    pub database_hash: String,
}

/// Cryptographic operations are injected so this module cannot accidentally
/// claim that a placeholder hash or signature check is production security.
pub trait PayloadCrypto {
    fn decode_base64(&self, value: &str) -> Result<Vec<u8>, String>;
    fn sha256_hex(&self, bytes: &[u8]) -> String;
    fn verify_ed25519(&self, public_key_pem: &[u8], message: &[u8], signature: &[u8]) -> bool;
}

/// Production adapter matching Node's SHA-256, base64, and Ed25519 SPKI PEM
/// formats used by `payload.cjs` and `build-runtime-payload.mjs`.
pub struct BuiltinPayloadCrypto;

impl PayloadCrypto for BuiltinPayloadCrypto {
    fn decode_base64(&self, value: &str) -> Result<Vec<u8>, String> {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(value)
            .map_err(|error| error.to_string())
    }

    fn sha256_hex(&self, bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn verify_ed25519(&self, public_key_pem: &[u8], message: &[u8], signature: &[u8]) -> bool {
        use base64::Engine;
        let Ok(pem) = std::str::from_utf8(public_key_pem) else {
            return false;
        };
        let body: String = pem
            .lines()
            .filter(|line| !line.starts_with("-----"))
            .flat_map(str::chars)
            .filter(|character| !character.is_whitespace())
            .collect();
        let Ok(der) = base64::engine::general_purpose::STANDARD.decode(body) else {
            return false;
        };
        // SubjectPublicKeyInfo DER for Ed25519 ends in the 32-byte raw key.
        const ED25519_SPKI_PREFIX: &[u8] = &[
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ];
        if der.len() != ED25519_SPKI_PREFIX.len() + 32 || !der.starts_with(ED25519_SPKI_PREFIX) {
            return false;
        }
        let Ok(key_bytes) = <&[u8; 32]>::try_from(&der[ED25519_SPKI_PREFIX.len()..]) else {
            return false;
        };
        let Ok(public_key) = ed25519_dalek::VerifyingKey::from_bytes(key_bytes) else {
            return false;
        };
        let Ok(signature_bytes) = <[u8; 64]>::try_from(signature) else {
            return false;
        };
        use ed25519_dalek::Verifier;
        public_key
            .verify(
                message,
                &ed25519_dalek::Signature::from_bytes(&signature_bytes),
            )
            .is_ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayloadError {
    InvalidEnvelope,
    InvalidSignature,
    IncompatibleBase,
    InvalidManifest,
    UnsafePath,
    IncompletePayload,
    PayloadTooLarge,
    PathCollision,
    InvalidFileHash,
    InvalidSelection,
}

impl PayloadError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::InvalidEnvelope => "Missing or invalid payload signature envelope",
            Self::InvalidSignature => "Invalid payload signature",
            Self::IncompatibleBase => {
                "Payload incompatible with shell or database; use full installer"
            }
            Self::InvalidManifest => "Invalid payload manifest",
            Self::UnsafePath => "Unsafe Windows payload path",
            Self::IncompletePayload => "Incomplete payload",
            Self::PayloadTooLarge => "Payload exceeds size limit",
            Self::PathCollision => "Payload path collision",
            Self::InvalidFileHash => "File integrity failure",
            Self::InvalidSelection => "Invalid payload selection",
        }
    }
}

pub fn tag_is_valid(tag: &str) -> bool {
    let value = tag.strip_prefix('v').unwrap_or("");
    let (version, suffix) = match value.split_once("-windows-beta.") {
        Some((version, beta)) if !beta.is_empty() && beta.bytes().all(|b| b.is_ascii_digit()) => {
            (version, true)
        }
        Some(_) => return false,
        None => (value, false),
    };
    let mut parts = version.split('.');
    let valid_version = (0..3).all(|_| {
        parts
            .next()
            .is_some_and(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    }) && parts.next().is_none();
    valid_version && (!suffix || tag.contains("-windows-beta."))
}

pub fn safe_payload_path(name: &str) -> Result<(), PayloadError> {
    if name.encode_utf16().count() > 400 {
        return Err(PayloadError::UnsafePath);
    }
    if name == "build.json" {
        return Ok(());
    }
    if !(name.starts_with("api/") || name.starts_with("web/")) {
        return Err(PayloadError::UnsafePath);
    }

    for part in name.split('/') {
        let lower = part.to_ascii_lowercase();
        let device = ["con", "prn", "aux", "nul"]
            .iter()
            .any(|reserved| lower == *reserved || lower.starts_with(&format!("{reserved}.")))
            || (0..=9).any(|n| {
                lower == format!("com{n}")
                    || lower.starts_with(&format!("com{n}."))
                    || lower == format!("lpt{n}")
                    || lower.starts_with(&format!("lpt{n}."))
            });
        if part.is_empty()
            || part == "."
            || part == ".."
            || part
                .chars()
                .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
            || part.ends_with('.')
            || part.ends_with(' ')
            || part.to_ascii_lowercase().starts_with(".env.")
            || lower == ".env"
            || device
        {
            return Err(PayloadError::UnsafePath);
        }
    }
    Ok(())
}

pub fn validate_manifest(manifest: &PayloadManifest) -> Result<(), PayloadError> {
    if manifest.protocol != 1
        || manifest.platform != "win32-x64"
        || !tag_is_valid(&manifest.base_tag)
        || !tag_is_valid(&manifest.tag)
        || !is_sha256(&manifest.shell_hash)
        || !is_sha256(&manifest.database_hash)
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_FILES
    {
        return Err(PayloadError::InvalidManifest);
    }

    let mut paths = HashSet::with_capacity(manifest.files.len());
    let mut total = 0_u64;
    for entry in &manifest.files {
        safe_payload_path(&entry.path)?;
        let folded = entry.path.to_ascii_lowercase();
        if !paths.insert(folded) || !is_sha256(&entry.sha256) {
            return Err(PayloadError::InvalidManifest);
        }
        if entry
            .source
            .as_deref()
            .is_some_and(|source| source != "base")
        {
            return Err(PayloadError::InvalidManifest);
        }
        total = total
            .checked_add(entry.size)
            .filter(|sum| *sum <= MAX_PAYLOAD_BYTES)
            .ok_or(PayloadError::PayloadTooLarge)?;
    }

    for required in REQUIRED_FILES {
        if !paths.contains(required) {
            return Err(PayloadError::IncompletePayload);
        }
    }
    for folded in &paths {
        let mut parent = folded.as_str();
        while let Some((head, _)) = parent.rsplit_once('/') {
            if paths.contains(head) {
                return Err(PayloadError::PathCollision);
            }
            parent = head;
        }
    }
    Ok(())
}

pub fn verify_signed_manifest<C: PayloadCrypto>(
    envelope: &PayloadEnvelope,
    public_key_pem: &[u8],
    expected: &BaseInfo,
    crypto: &C,
) -> Result<PayloadManifest, PayloadError> {
    let envelope_bytes = serde_json::to_vec(envelope).map_err(|_| PayloadError::InvalidEnvelope)?;
    if envelope_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(PayloadError::InvalidManifest);
    }
    let bytes = crypto
        .decode_base64(&envelope.manifest)
        .map_err(|_| PayloadError::InvalidEnvelope)?;
    let signature = crypto
        .decode_base64(&envelope.signature)
        .map_err(|_| PayloadError::InvalidEnvelope)?;
    if bytes.is_empty() || bytes.len() > MAX_MANIFEST_BYTES {
        return Err(PayloadError::InvalidManifest);
    }
    if !crypto.verify_ed25519(public_key_pem, &bytes, &signature) {
        return Err(PayloadError::InvalidSignature);
    }
    let manifest: PayloadManifest =
        serde_json::from_slice(&bytes).map_err(|_| PayloadError::InvalidManifest)?;
    validate_manifest(&manifest)?;
    if manifest.protocol != expected.protocol
        || manifest.platform != expected.platform
        || manifest.base_tag != expected.base_tag
        || manifest.shell_hash != expected.shell_hash
        || manifest.database_hash != expected.database_hash
    {
        return Err(PayloadError::IncompatibleBase);
    }
    Ok(manifest)
}

pub fn verify_file_bytes<C: PayloadCrypto>(
    entry: &PayloadFile,
    bytes: &[u8],
    crypto: &C,
) -> Result<(), PayloadError> {
    safe_payload_path(&entry.path)?;
    if bytes.len() as u64 != entry.size || crypto.sha256_hex(bytes) != entry.sha256 {
        return Err(PayloadError::InvalidFileHash);
    }
    Ok(())
}

/// Resolves the immutable baseline values used in the signed manifest.
pub fn base_info_from_runtime<C: PayloadCrypto>(
    runtime: &Path,
    crypto: &C,
) -> Result<BaseInfo, PayloadError> {
    ensure_directory_not_link(runtime)?;
    let build: serde_json::Value = read_json(&runtime.join("build.json"))?;
    let base_tag = build
        .get("tag")
        .and_then(serde_json::Value::as_str)
        .filter(|tag| tag_is_valid(tag))
        .ok_or(PayloadError::InvalidManifest)?
        .to_owned();
    let shell_bytes =
        fs::read(runtime.join("shell-contract.json")).map_err(|_| PayloadError::InvalidManifest)?;
    let shell_hash = crypto.sha256_hex(&shell_bytes);
    let database_hash = database_hash(&runtime.join("api").join("prisma"))?;
    Ok(BaseInfo {
        protocol: 1,
        platform: "win32-x64".into(),
        base_tag,
        shell_hash,
        database_hash,
    })
}

/// Rechecks all installed files and the database source fingerprint before a
/// selection can be queued or launched. Links and special file types fail closed.
pub fn verify_installed_version<C: PayloadCrypto>(
    root: &Path,
    manifest: &PayloadManifest,
    crypto: &C,
) -> Result<(), PayloadError> {
    validate_manifest(manifest)?;
    if fs::symlink_metadata(root)
        .map_err(|_| PayloadError::InvalidSelection)?
        .file_type()
        .is_symlink()
    {
        return Err(PayloadError::UnsafePath);
    }
    let expected: HashSet<String> = manifest
        .files
        .iter()
        .map(|entry| entry.path.to_ascii_lowercase())
        .collect();
    let mut actual = files_in(root, "")?;
    actual.retain(|file| file != "signed-manifest.json");
    let actual_set: HashSet<String> = actual
        .iter()
        .map(|file| file.to_ascii_lowercase())
        .collect();
    if actual.len() != manifest.files.len() || actual_set != expected {
        return Err(PayloadError::InvalidSelection);
    }
    for entry in &manifest.files {
        let path = root.join(entry.path.split('/').collect::<PathBuf>());
        let metadata = fs::symlink_metadata(&path).map_err(|_| PayloadError::InvalidSelection)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(PayloadError::UnsafePath);
        }
        let bytes = fs::read(path).map_err(|_| PayloadError::InvalidSelection)?;
        verify_file_bytes(entry, &bytes, crypto)?;
    }
    let db_hash = database_hash(&root.join("api").join("prisma"))?;
    if db_hash != manifest.database_hash {
        return Err(PayloadError::InvalidFileHash);
    }
    let build: serde_json::Value = read_json(&root.join("build.json"))?;
    if build.get("tag").and_then(serde_json::Value::as_str) != Some(manifest.tag.as_str()) {
        return Err(PayloadError::InvalidManifest);
    }
    Ok(())
}

pub fn verify_persisted_version<C: PayloadCrypto>(
    runtime: &Path,
    data: &Path,
    id: &str,
    public_key_pem: &[u8],
    crypto: &C,
) -> Result<PathBuf, PayloadError> {
    if !valid_selection_id(id) {
        return Err(PayloadError::InvalidSelection);
    }
    let root = version_root(data, id)?;
    for directory in [
        data.to_path_buf(),
        data.join("app-updates"),
        data.join("app-updates").join("versions"),
        root.clone(),
    ] {
        ensure_directory_not_link(&directory)?;
    }
    let envelope: PayloadEnvelope = read_json(&root.join("signed-manifest.json"))?;
    let base = base_info_from_runtime(runtime, crypto)?;
    let manifest = verify_signed_manifest(&envelope, public_key_pem, &base, crypto)?;
    if manifest.tag != id.rsplit_once('-').map(|pair| pair.0).unwrap_or_default() {
        return Err(PayloadError::InvalidSelection);
    }
    verify_installed_version(&root, &manifest, crypto)?;
    Ok(root)
}

pub fn version_root(data: &Path, id: &str) -> Result<PathBuf, PayloadError> {
    if !valid_selection_id(id) {
        return Err(PayloadError::InvalidSelection);
    }
    Ok(data.join("app-updates").join("versions").join(id))
}

/// Возраст, после которого версия, не упомянутая в state.json, считается
/// мусором и удаляется. Молодые нереференсные каталоги не трогаем: между
/// скачиванием и queue лежит окно, где каталог ещё не записан в state.
pub const STALE_VERSION_TTL: Duration = Duration::from_secs(48 * 60 * 60);

/// Ротация `app-updates/versions`: удаляет каталоги версий, которые не
/// упомянуты в state.json (base/pending/trial/active/previous/failed) и
/// старше `max_age`. Возвращает число удалённых каталогов; ошибки чтения
/// отдельных записей пропускаются, сама ротация никогда не ломает выбор
/// версии — её вызывают после успешной записи state.
pub fn prune_stale_versions(data: &Path, max_age: Duration) -> Result<usize, PayloadError> {
    let state = read_selection_state(data)?;
    let referenced = [
        state.base_id,
        state.pending,
        state.trial,
        state.active,
        state.previous,
        state.failed,
    ]
    .into_iter()
    .flatten()
    .collect::<HashSet<_>>();
    let versions = data.join("app-updates").join("versions");
    let entries = match fs::read_dir(&versions) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(_) => return Err(PayloadError::InvalidManifest),
    };
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !valid_selection_id(name) || referenced.contains(name) {
            continue;
        }
        // Симлинк или не-каталог: не удаляем из ротации, пусть решают
        // проверки безопасности пути (ensure_directory_not_link).
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(age) = now.duration_since(modified) else {
            continue;
        };
        if age < max_age {
            continue;
        }
        if fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn read_selection_state(data: &Path) -> Result<SelectionState, PayloadError> {
    ensure_directory_not_link(data)?;
    let updates = data.join("app-updates");
    match fs::symlink_metadata(&updates) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(PayloadError::UnsafePath)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SelectionState::default())
        }
        Err(_) => return Err(PayloadError::InvalidManifest),
        _ => {}
    }
    let path = data.join("app-updates").join("state.json");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(PayloadError::UnsafePath)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SelectionState::default())
        }
        Err(_) => return Err(PayloadError::InvalidManifest),
        _ => {}
    }
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| PayloadError::InvalidManifest),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(SelectionState::default()),
        Err(_) => Err(PayloadError::InvalidManifest),
    }
}

/// Writes state via a sibling temporary file, flushes it, then atomically
/// replaces the destination on both Unix and Windows.
pub fn write_selection_state_atomic(
    data: &Path,
    state: &SelectionState,
) -> Result<(), PayloadError> {
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let path = data.join("app-updates").join("state.json");
    let parent = path.parent().ok_or(PayloadError::InvalidManifest)?;
    ensure_directory_not_link(data)?;
    match fs::symlink_metadata(parent) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(PayloadError::UnsafePath)
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(parent).map_err(|_| PayloadError::InvalidManifest)?;
            ensure_directory_not_link(parent)?;
        }
        Err(_) => return Err(PayloadError::InvalidManifest),
    }
    let state_exists = match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(PayloadError::UnsafePath)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err(PayloadError::InvalidManifest),
        _ => true,
    };
    if state_exists {
        // Never replace a state file whose shape cannot be read and preserved.
        let _ = read_selection_state(data)?;
    }
    let json = serde_json::to_vec(state).map_err(|_| PayloadError::InvalidManifest)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(
        "state.json.{}.{nonce:x}.{sequence:x}.tmp",
        std::process::id()
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| PayloadError::InvalidManifest)?;
    let result = (|| {
        file.write_all(&json)
            .map_err(|_| PayloadError::InvalidManifest)?;
        file.sync_all().map_err(|_| PayloadError::InvalidManifest)?;
        drop(file);
        replace_file(&temp, &path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), PayloadError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
        const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
        #[link(name = "Kernel32")]
        unsafe extern "system" {
            fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
        }
        let existing: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let new: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // SAFETY: both buffers are valid, NUL-terminated UTF-16 paths for this call.
        let ok = unsafe {
            MoveFileExW(
                existing.as_ptr(),
                new.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if ok == 0 {
            return Err(PayloadError::InvalidManifest);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, destination).map_err(|_| PayloadError::InvalidManifest)
    }
}

fn database_hash(root: &Path) -> Result<String, PayloadError> {
    // Only the normal Prisma layout and ASCII lowercase names are accepted.
    // That subset lets us reproduce Node's localeCompare('en') order exactly.
    let files = database_files_in(root, "")?;
    let mut hash = Sha256::new();
    for file in files {
        hash.update(file.as_bytes());
        hash.update([0]);
        let bytes = fs::read(root.join(file.split('/').collect::<PathBuf>()))
            .map_err(|_| PayloadError::InvalidSelection)?;
        hash.update(bytes);
        hash.update([0]);
    }
    Ok(hex(&hash.finalize()))
}

fn files_in(root: &Path, prefix: &str) -> Result<Vec<String>, PayloadError> {
    let directory = if prefix.is_empty() {
        root.to_path_buf()
    } else {
        root.join(prefix)
    };
    let mut entries = fs::read_dir(directory)
        .map_err(|_| PayloadError::InvalidSelection)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| PayloadError::InvalidSelection)?;
    entries.sort_by_key(|entry| entry.file_name());
    let mut files = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let kind = entry
            .file_type()
            .map_err(|_| PayloadError::InvalidSelection)?;
        if kind.is_symlink() {
            return Err(PayloadError::UnsafePath);
        }
        if kind.is_dir() {
            files.extend(files_in(root, &relative)?);
        } else if kind.is_file() {
            files.push(relative);
        } else {
            return Err(PayloadError::UnsafePath);
        }
    }
    Ok(files)
}

fn database_files_in(root: &Path, prefix: &str) -> Result<Vec<String>, PayloadError> {
    let directory = if prefix.is_empty() {
        root.to_path_buf()
    } else {
        root.join(prefix)
    };
    let mut entries = fs::read_dir(directory)
        .map_err(|_| PayloadError::InvalidSelection)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| PayloadError::InvalidSelection)?;
    for entry in &entries {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(PayloadError::UnsafePath);
        };
        if !valid_prisma_name(prefix, name) {
            return Err(PayloadError::UnsafePath);
        }
    }
    entries.sort_by(|left, right| {
        node_en_prisma_cmp(
            left.file_name().to_str().unwrap_or_default(),
            right.file_name().to_str().unwrap_or_default(),
        )
    });

    let mut files = Vec::new();
    for entry in entries {
        let name = entry
            .file_name()
            .to_str()
            .ok_or(PayloadError::UnsafePath)?
            .to_owned();
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let kind = entry
            .file_type()
            .map_err(|_| PayloadError::InvalidSelection)?;
        if kind.is_symlink() {
            return Err(PayloadError::UnsafePath);
        }
        let expected_kind = match prefix {
            "" if name == "migrations" => kind.is_dir(),
            "" => kind.is_file(),
            "migrations" if name == "migration_lock.toml" => kind.is_file(),
            "migrations" => kind.is_dir(),
            _ => kind.is_file(),
        };
        if !expected_kind {
            return Err(PayloadError::UnsafePath);
        }
        if kind.is_dir() {
            files.extend(database_files_in(root, &relative)?);
        } else if kind.is_file() {
            files.push(relative);
        } else {
            return Err(PayloadError::UnsafePath);
        }
    }
    Ok(files)
}

fn valid_prisma_name(prefix: &str, name: &str) -> bool {
    let valid_component = name
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte));
    if !valid_component {
        return false;
    }
    match prefix {
        "" => matches!(name, "schema.prisma" | "migration_lock.toml" | "migrations"),
        "migrations" => {
            name == "migration_lock.toml"
                || (name.len() > 15
                    && name.as_bytes()[..14].iter().all(u8::is_ascii_digit)
                    && name.as_bytes()[14] == b'_'
                    && name[15..].bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                    }))
        }
        value if value.starts_with("migrations/") => name == "migration.sql",
        _ => false,
    }
}

fn node_en_prisma_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    fn weight(byte: u8) -> u8 {
        match byte {
            b'_' => 0,
            b'-' => 1,
            b'.' => 2,
            b'0'..=b'9' => 3 + byte - b'0',
            b'a'..=b'z' => 20 + byte - b'a',
            _ => 255,
        }
    }
    left.bytes().map(weight).cmp(right.bytes().map(weight))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, PayloadError> {
    if fs::symlink_metadata(path)
        .map_err(|_| PayloadError::InvalidManifest)?
        .file_type()
        .is_symlink()
    {
        return Err(PayloadError::UnsafePath);
    }
    let bytes = fs::read(path).map_err(|_| PayloadError::InvalidManifest)?;
    serde_json::from_slice(&bytes).map_err(|_| PayloadError::InvalidManifest)
}

fn ensure_directory_not_link(path: &Path) -> Result<(), PayloadError> {
    if !path.is_absolute() {
        return Err(PayloadError::UnsafePath);
    }
    for ancestor in path.ancestors() {
        let metadata =
            fs::symlink_metadata(ancestor).map_err(|_| PayloadError::InvalidSelection)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(PayloadError::UnsafePath);
        }
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

pub fn valid_selection_id(id: &str) -> bool {
    let Some((tag, nonce)) = id.rsplit_once('-') else {
        return false;
    };
    tag_is_valid(tag)
        && nonce.len() == 16
        && nonce
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
    #[serde(default)]
    pub previous: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadSelection {
    pub id: Option<String>,
    pub trial: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledSelection {
    pub root: PathBuf,
    pub id: Option<String>,
    pub trial: bool,
    pub failed: Option<String>,
}

pub fn queue_installed_update<C: PayloadCrypto>(
    runtime: &Path,
    data: &Path,
    id: &str,
    public_key_pem: &[u8],
    crypto: &C,
) -> Result<(), PayloadError> {
    verify_persisted_version(runtime, data, id, public_key_pem, crypto)?;
    let mut state = read_selection_state(data)?;
    queue_payload(&mut state, id, |_| true)?;
    write_selection_state_atomic(data, &state)
}

/// Selects a previously prepared payload and persists the trial transition.
/// The returned directory is only a selection hint; this function never starts it.
pub fn select_installed_payload<C: PayloadCrypto>(
    runtime: &Path,
    data: &Path,
    public_key_pem: Option<&[u8]>,
    crypto: &C,
) -> Result<InstalledSelection, PayloadError> {
    let base_build =
        fs::read(runtime.join("build.json")).map_err(|_| PayloadError::InvalidManifest)?;
    let base_id = crypto.sha256_hex(&base_build);
    let mut state = read_selection_state(data)?;
    let selection = select_payload(&mut state, &base_id, |candidate| {
        public_key_pem.is_some_and(|key| {
            verify_persisted_version(runtime, data, candidate, key, crypto).is_ok()
        })
    })?;
    write_selection_state_atomic(data, &state)?;
    // Ротация старых версий после фиксации state: сбой уборки не должен
    // влиять на выбор, поэтому считаем только для диагностики.
    match prune_stale_versions(data, STALE_VERSION_TTL) {
        Ok(removed) if removed > 0 => {
            eprintln!("[orion-runtime] pruned {removed} stale payload version dir(s)")
        }
        Ok(_) => {}
        Err(_) => eprintln!("[orion-runtime] payload version rotation skipped (state unreadable)"),
    }
    let root = match selection.id.as_deref() {
        Some(id) => version_root(data, id)?,
        None => runtime.to_path_buf(),
    };
    Ok(InstalledSelection {
        root,
        id: selection.id,
        trial: selection.trial,
        failed: state.failed,
    })
}

/// Commits only when the UI ACK matches the selected trial and API health is good.
/// A not-ready response leaves the trial intact for the launcher's timeout policy.
pub fn acknowledge_installed_trial(
    data: &Path,
    ack_build_tag: Option<&str>,
    http_success: bool,
    database_ok: bool,
) -> Result<bool, PayloadError> {
    let mut state = read_selection_state(data)?;
    let Some(trial) = state.trial.as_deref() else {
        return Ok(false);
    };
    let tag = trial
        .rsplit_once('-')
        .map(|pair| pair.0)
        .ok_or(PayloadError::InvalidSelection)?;
    if !trial_ready(ack_build_tag, tag, http_success, database_ok) {
        return Ok(false);
    }
    settle_trial(&mut state, true);
    write_selection_state_atomic(data, &state)?;
    Ok(true)
}

/// Marks a failed/timed-out trial while retaining all version directories and
/// the prior active selection for the next launch's fallback.
pub fn rollback_installed_trial(data: &Path) -> Result<bool, PayloadError> {
    let mut state = read_selection_state(data)?;
    if state.trial.is_none() {
        return Ok(false);
    }
    settle_trial(&mut state, false);
    write_selection_state_atomic(data, &state)?;
    Ok(true)
}

/// Applies the launch-time state transitions from payload.cjs. `verify`
/// must fully validate the persisted version before returning true.
pub fn select_payload(
    state: &mut SelectionState,
    base_id: &str,
    mut verify: impl FnMut(&str) -> bool,
) -> Result<PayloadSelection, PayloadError> {
    if state.base_id.as_deref().is_some_and(|old| old != base_id) {
        *state = SelectionState::default();
    }
    state.base_id = Some(base_id.to_owned());

    if let Some(interrupted) = state.trial.take() {
        state.failed = Some(interrupted);
        state.pending = None;
    }
    if state.pending.is_some() {
        state.trial = state.pending.take();
    }

    let mut selected = state.trial.clone().or_else(|| state.active.clone());
    if let Some(id) = selected.clone() {
        if !valid_selection_id(&id) || !verify(&id) {
            state.failed = Some(id);
            if state.trial.take().is_some() {
                selected = state.active.clone();
                if let Some(fallback) = selected.clone() {
                    if !valid_selection_id(&fallback) || !verify(&fallback) {
                        state.active = None;
                        selected = None;
                    }
                }
            } else {
                state.active = None;
                selected = state.previous.clone();
                if let Some(fallback) = selected.clone() {
                    if !valid_selection_id(&fallback) || !verify(&fallback) {
                        selected = None;
                    } else {
                        state.active = Some(fallback);
                    }
                }
            }
        }
    }
    Ok(PayloadSelection {
        id: selected,
        trial: state.trial.is_some(),
    })
}

pub fn queue_payload(
    state: &mut SelectionState,
    id: &str,
    verify: impl FnOnce(&str) -> bool,
) -> Result<(), PayloadError> {
    if !valid_selection_id(id) || !verify(id) {
        return Err(PayloadError::InvalidSelection);
    }
    if state.trial.is_some() {
        return Err(PayloadError::InvalidSelection);
    }
    state.pending = Some(id.to_owned());
    Ok(())
}

pub fn settle_trial(state: &mut SelectionState, success: bool) {
    let Some(trial) = state.trial.take() else {
        return;
    };
    if success {
        state.previous = state.active.clone();
        state.active = Some(trial);
        state.failed = None;
    } else {
        state.failed = Some(trial);
    }
}

/// Mirrors launcher.cjs: the build UI must ACK its tag and API health must
/// report both an HTTP success and `database=ok` before committing a trial.
pub fn trial_ready(
    ack_build_tag: Option<&str>,
    expected_build_tag: &str,
    http_success: bool,
    database_ok: bool,
) -> bool {
    ack_build_tag == Some(expected_build_tag)
        && tag_is_valid(expected_build_tag)
        && http_success
        && database_ok
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
