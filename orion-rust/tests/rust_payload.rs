#[path = "../src/rust_payload.rs"]
mod rust_payload;

use rust_payload::{
    queue_payload, select_payload, settle_trial, trial_ready, validate_manifest, verify_file_bytes,
    verify_signed_manifest, BaseInfo, PayloadCrypto, PayloadEnvelope, PayloadError, PayloadFile,
    PayloadManifest, SelectionState,
};

struct TestCrypto {
    signature_ok: bool,
}

impl PayloadCrypto for TestCrypto {
    fn decode_base64(&self, value: &str) -> Result<Vec<u8>, String> {
        Ok(value.as_bytes().to_vec())
    }

    fn sha256_hex(&self, bytes: &[u8]) -> String {
        let sum = bytes.iter().fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
        format!("{sum:02x}").repeat(32)
    }

    fn verify_ed25519(&self, _key: &[u8], _message: &[u8], _signature: &[u8]) -> bool {
        self.signature_ok
    }
}

fn hash() -> String {
    "a".repeat(64)
}

fn id(tag: &str, nonce: char) -> String {
    format!("{tag}-{}", nonce.to_string().repeat(16))
}

fn manifest() -> PayloadManifest {
    PayloadManifest {
        protocol: 1,
        platform: "win32-x64".into(),
        base_tag: "v1.2.3".into(),
        shell_hash: hash(),
        database_hash: hash(),
        tag: "v1.2.4-windows-beta.2".into(),
        files: [
            "api/dist/main.js",
            "api/package.json",
            "api/prisma/schema.prisma",
            "web/index.html",
            "build.json",
        ]
        .into_iter()
        .map(|path| PayloadFile {
            path: path.into(),
            size: 1,
            sha256: hash(),
            source: None,
        })
        .collect(),
    }
}

#[test]
fn path_validation_rejects_traversal_devices_and_private_config() {
    for path in [
        "api/../secret",
        "api/CON.txt",
        "web/.env.local",
        "api/file.",
        "api/file ",
        "api/a\\b",
        "other/index.html",
    ] {
        assert!(rust_payload::safe_payload_path(path).is_err(), "{path}");
    }
    assert!(rust_payload::safe_payload_path("build.json").is_ok());
    assert!(rust_payload::safe_payload_path("web/assets/app.js").is_ok());
}

#[test]
fn manifest_validation_requires_anchors_and_rejects_case_and_parent_collisions() {
    let good = manifest();
    validate_manifest(&good).unwrap();

    let mut missing = good.clone();
    missing.files.retain(|entry| entry.path != "web/index.html");
    assert_eq!(
        validate_manifest(&missing),
        Err(PayloadError::IncompletePayload)
    );

    let mut duplicate = good.clone();
    let mut duplicate_file = duplicate.files[0].clone();
    duplicate_file.path = "api/dist/MAIN.js".into();
    duplicate.files.push(duplicate_file);
    assert_eq!(
        validate_manifest(&duplicate),
        Err(PayloadError::InvalidManifest)
    );

    let mut collision = good;
    collision.files.push(PayloadFile {
        path: "api/dist".into(),
        size: 0,
        sha256: hash(),
        source: None,
    });
    assert_eq!(
        validate_manifest(&collision),
        Err(PayloadError::PathCollision)
    );
}

#[test]
fn signed_manifest_requires_signature_valid_shape_and_matching_base() {
    let bytes = serde_json::to_vec(&manifest()).unwrap();
    let envelope = PayloadEnvelope {
        manifest: String::from_utf8(bytes).unwrap(),
        signature: "signature".into(),
    };
    let base = BaseInfo {
        protocol: 1,
        platform: "win32-x64".into(),
        base_tag: "v1.2.3".into(),
        shell_hash: hash(),
        database_hash: hash(),
    };
    let crypto = TestCrypto { signature_ok: true };
    assert!(verify_signed_manifest(&envelope, b"test-key", &base, &crypto).is_ok());

    let reject = TestCrypto {
        signature_ok: false,
    };
    assert_eq!(
        verify_signed_manifest(&envelope, b"test-key", &base, &reject),
        Err(PayloadError::InvalidSignature)
    );

    let wrong_base = BaseInfo {
        shell_hash: "b".repeat(64),
        ..base
    };
    assert_eq!(
        verify_signed_manifest(&envelope, b"test-key", &wrong_base, &crypto),
        Err(PayloadError::IncompatibleBase)
    );
}

#[test]
fn file_integrity_checks_both_size_and_digest() {
    let crypto = TestCrypto { signature_ok: true };
    let bytes = b"payload";
    let entry = PayloadFile {
        path: "web/index.html".into(),
        size: bytes.len() as u64,
        sha256: crypto.sha256_hex(bytes),
        source: None,
    };
    assert!(verify_file_bytes(&entry, bytes, &crypto).is_ok());
    assert_eq!(
        verify_file_bytes(&entry, b"tampered", &crypto),
        Err(PayloadError::InvalidFileHash)
    );
}

#[test]
fn pending_payload_is_a_trial_then_ack_and_health_commit_it() {
    let mut state = SelectionState::default();
    let candidate = id("v1.2.4", 'a');
    queue_payload(&mut state, &candidate, |_| true).unwrap();
    assert!(queue_payload(&mut state, &candidate, |_| true).is_ok());

    let selection = select_payload(&mut state, "base-1", |_| true).unwrap();
    assert_eq!(selection.id.as_deref(), Some(candidate.as_str()));
    assert!(selection.trial);
    assert!(!trial_ready(Some("v1.2.3"), "v1.2.4", true, true));
    assert!(!trial_ready(Some("v1.2.4"), "v1.2.4", false, true));
    assert!(!trial_ready(Some("v1.2.4"), "v1.2.4", true, false));
    assert!(trial_ready(Some("v1.2.4"), "v1.2.4", true, true));

    settle_trial(&mut state, true);
    assert_eq!(state.active.as_deref(), Some(candidate.as_str()));
    assert_eq!(state.previous, None);
    assert_eq!(state.trial, None);
}

#[test]
fn interrupted_trial_and_failed_trial_fall_back_to_verified_active() {
    let previous = id("v1.2.2", 'b');
    let interrupted = id("v1.2.3", 'c');
    let pending = id("v1.2.4", 'd');
    let mut state = SelectionState {
        active: Some(previous.clone()),
        trial: Some(interrupted.clone()),
        pending: Some(pending.clone()),
        ..SelectionState::default()
    };
    let selection =
        select_payload(&mut state, "base-1", |candidate| candidate == previous).unwrap();
    assert_eq!(selection.id.as_deref(), Some(previous.as_str()));
    assert!(!selection.trial);
    assert_eq!(state.failed.as_deref(), Some(interrupted.as_str()));
    assert_eq!(state.pending, None);

    let candidate = id("v1.2.5", 'e');
    state.pending = Some(candidate.clone());
    let selection = select_payload(&mut state, "base-1", |candidate_id| {
        candidate_id != candidate
    })
    .unwrap();
    assert_eq!(selection.id.as_deref(), Some(previous.as_str()));
    assert!(!selection.trial);
    assert_eq!(state.failed.as_deref(), Some(candidate.as_str()));
}

#[test]
fn new_full_installer_base_discards_old_selection_and_queue_checks_ids() {
    let old = id("v1.2.2", 'f');
    let mut state = SelectionState {
        base_id: Some("old-base".into()),
        active: Some(old),
        ..SelectionState::default()
    };
    let selection = select_payload(&mut state, "new-base", |_| true).unwrap();
    assert_eq!(selection.id, None);
    assert_eq!(state.active, None);
    assert_eq!(state.base_id.as_deref(), Some("new-base"));
    assert!(queue_payload(&mut state, "../../escape", |_| true).is_err());
}
