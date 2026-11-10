#[path = "../src/rust_payload.rs"]
mod rust_payload;

use rust_payload::{
    acknowledge_installed_trial, base_info_from_runtime, queue_installed_update,
    read_selection_state, rollback_installed_trial, select_installed_payload,
    verify_persisted_version, write_selection_state_atomic, BuiltinPayloadCrypto, PayloadCrypto,
    SelectionState,
};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn scratch_dir() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path =
        std::env::temp_dir().join(format!("orion-rust-payload-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&path).unwrap();
    path
}

fn node(payload: &Path, args: &[&str], script: &str) -> std::process::Output {
    Command::new("node")
        .arg("-e")
        .arg(script)
        .arg(payload)
        .args(args)
        .output()
        .expect("Node.js is required for the cross-language payload protocol test")
}

const NODE_SETUP: &str = r#"
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const payload = require(process.argv[1]);
const base = process.argv[2];
const data = process.argv[3];
const prismaSource = process.argv[4];
const put = (root, name, text) => {
  const file = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
put(base, 'build.json', JSON.stringify({tag:'v1.2.3'}));
put(base, 'shell-contract.json', '{"protocol":1}\n');
fs.mkdirSync(path.join(base, 'api'), {recursive:true});
fs.cpSync(prismaSource, path.join(base, 'api/prisma'), {recursive:true});
const id = 'v1.2.4-windows-beta.7-abcdef0123456789';
const files = {
  'api/dist/main.js': 'module.exports = 1;\n',
  'api/package.json': '{"name":"orion-api","version":"1.2.4"}\n',
  'web/index.html': '<!doctype html><title>ORION</title>\n',
  'build.json': JSON.stringify({tag:'v1.2.4-windows-beta.7'}) + '\n',
};
for (const name of payload.filesIn(path.join(base, 'api/prisma'))) {
  files[`api/prisma/${name}`] = fs.readFileSync(path.join(base, 'api/prisma', ...name.split('/')));
}
const pair = crypto.generateKeyPairSync('ed25519');
const manifestFiles = Object.entries(files).map(([name, body]) => ({
  path:name, size:Buffer.byteLength(body), sha256:payload.sha(Buffer.from(body)),
}));
const manifest = Buffer.from(JSON.stringify({ ...payload.baseInfo(base), tag:'v1.2.4-windows-beta.7', commit:'interop', files:manifestFiles }));
const envelope = {
  manifest:manifest.toString('base64'),
  signature:crypto.sign(null, manifest, pair.privateKey).toString('base64'),
};
fs.writeFileSync(path.join(base, 'update-public-key.pem'), pair.publicKey.export({type:'spki',format:'pem'}));
payload.readManifest(Buffer.from(JSON.stringify(envelope)), base);
const root = path.join(data, 'app-updates', 'versions', id);
for (const [name, body] of Object.entries(files)) put(root, name, body);
put(root, 'signed-manifest.json', JSON.stringify(envelope));
process.stdout.write(JSON.stringify({id, publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString()}));
"#;

const NODE_VERIFY: &str = r#"
const payload = require(process.argv[1]);
try {
  payload.verifyVersion(process.argv[2], process.argv[3], process.argv[4]);
  process.stdout.write('accepted');
} catch (error) {
  process.stdout.write(`rejected:${error.message}`);
  process.exitCode = 2;
}
"#;

const NODE_DATABASE_HASH: &str = r#"
const payload = require(process.argv[1]);
process.stdout.write(payload.databaseHash(process.argv[2]));
"#;

const NODE_STATE_ACTION: &str = r#"
const payload = require(process.argv[1]);
const runtime = process.argv[2];
const data = process.argv[3];
const action = process.argv[4];
const id = process.argv[5];
if (action === 'queue') payload.queue(runtime, data, id);
else if (action === 'select') {
  const selection = payload.select(runtime, data);
  process.stdout.write(JSON.stringify({id:selection.id ?? null, trial:selection.trial, state:payload.readState(data)}));
} else if (action === 'settle') payload.settle(data, true);
else if (action === 'rollback') payload.settle(data, false);
process.stdout.write(action === 'select' ? '' : JSON.stringify(payload.readState(data)));
"#;

fn copy_dir(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn node_state_action(payload: &Path, runtime: &Path, data: &Path, action: &str, id: &str) -> Value {
    let output = node(
        payload,
        &[
            runtime.to_str().unwrap(),
            data.to_str().unwrap(),
            action,
            id,
        ],
        NODE_STATE_ACTION,
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap_or(Value::Null)
}

#[test]
fn node_signed_manifest_and_rust_verify_the_same_files_and_reject_mutations() {
    let scratch = scratch_dir();
    let base = scratch.join("runtime");
    let data = scratch.join("data");
    fs::create_dir_all(&base).unwrap();
    fs::create_dir_all(&data).unwrap();
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let payload_module = repository.join("apps/desktop/runtime/payload.cjs");
    let prisma_source = repository.join("apps/api/prisma");

    let setup = node(
        &payload_module,
        &[
            base.to_str().unwrap(),
            data.to_str().unwrap(),
            prisma_source.to_str().unwrap(),
        ],
        NODE_SETUP,
    );
    assert!(
        setup.status.success(),
        "{}",
        String::from_utf8_lossy(&setup.stderr)
    );
    let output: Value = serde_json::from_slice(&setup.stdout).unwrap();
    let id = output["id"].as_str().unwrap();
    let public_key = output["publicKey"].as_str().unwrap().as_bytes();
    let crypto = BuiltinPayloadCrypto;

    let key_path = base.join("update-public-key.pem");
    fs::remove_file(&key_path).unwrap();
    let baseline_data = scratch.join("baseline-data");
    fs::create_dir_all(&baseline_data).unwrap();
    let rust_baseline = select_installed_payload(&base, &baseline_data, None, &crypto).unwrap();
    let node_baseline = node_state_action(&payload_module, &base, &baseline_data, "select", "");
    assert_eq!(rust_baseline.root, base);
    assert_eq!(rust_baseline.id, None);
    assert!(!rust_baseline.trial);
    assert_eq!(
        node_baseline,
        serde_json::json!({
            "id": null,
            "trial": false,
            "state": read_selection_state(&baseline_data).unwrap(),
        })
    );
    let pending_without_key = SelectionState {
        pending: Some(id.to_owned()),
        ..SelectionState::default()
    };
    write_selection_state_atomic(&baseline_data, &pending_without_key).unwrap();
    let rust_no_key_fallback =
        select_installed_payload(&base, &baseline_data, None, &crypto).unwrap();
    let node_no_key_fallback =
        node_state_action(&payload_module, &base, &baseline_data, "select", "");
    assert_eq!(rust_no_key_fallback.root, base);
    assert_eq!(rust_no_key_fallback.failed.as_deref(), Some(id));
    assert_eq!(
        node_no_key_fallback,
        serde_json::json!({
            "id": null,
            "trial": false,
            "state": read_selection_state(&baseline_data).unwrap(),
        })
    );
    fs::write(&key_path, public_key).unwrap();

    verify_persisted_version(&base, &data, id, public_key, &crypto)
        .unwrap_or_else(|error| panic!("Rust rejected Node-signed fixture: {error:?}"));
    let accepted = node(
        &payload_module,
        &[base.to_str().unwrap(), data.to_str().unwrap(), id],
        NODE_VERIFY,
    );
    assert!(accepted.status.success());
    assert_eq!(String::from_utf8_lossy(&accepted.stdout), "accepted");

    let candidate = id.to_owned();
    let mut initial = SelectionState::default();
    initial
        .extra
        .insert("futureField".into(), serde_json::json!({"keep":true}));
    write_selection_state_atomic(&data, &initial).unwrap();
    queue_installed_update(&base, &data, &candidate, public_key, &crypto).unwrap();
    let node_queued = node_state_action(&payload_module, &base, &data, "queue", &candidate);
    assert_eq!(
        node_queued,
        serde_json::to_value(read_selection_state(&data).unwrap()).unwrap()
    );

    let mut pending = initial.clone();
    pending.pending = Some(candidate.clone());
    write_selection_state_atomic(&data, &pending).unwrap();
    let node_trial = node_state_action(&payload_module, &base, &data, "select", "");
    write_selection_state_atomic(&data, &pending).unwrap();
    let rust_trial = select_installed_payload(&base, &data, Some(public_key), &crypto).unwrap();
    assert_eq!(rust_trial.id.as_deref(), Some(candidate.as_str()));
    assert!(rust_trial.trial);
    assert_eq!(
        node_trial,
        serde_json::json!({
            "id": rust_trial.id,
            "trial": rust_trial.trial,
            "state": read_selection_state(&data).unwrap(),
        })
    );
    assert!(!acknowledge_installed_trial(&data, Some("v0.0.0"), true, true).unwrap());
    assert!(
        !acknowledge_installed_trial(&data, Some("v1.2.4-windows-beta.7"), true, false).unwrap()
    );
    assert_eq!(
        read_selection_state(&data).unwrap().trial.as_deref(),
        Some(candidate.as_str())
    );
    assert!(acknowledge_installed_trial(&data, Some("v1.2.4-windows-beta.7"), true, true).unwrap());
    let rust_committed = read_selection_state(&data).unwrap();
    write_selection_state_atomic(
        &data,
        &SelectionState {
            base_id: rust_committed.base_id.clone(),
            trial: Some(candidate.clone()),
            extra: initial.extra.clone(),
            ..SelectionState::default()
        },
    )
    .unwrap();
    let node_committed = node_state_action(&payload_module, &base, &data, "settle", "");
    assert_eq!(
        node_committed,
        serde_json::to_value(rust_committed).unwrap()
    );

    let old_id = format!("{}-1111111111111111", candidate.rsplit_once('-').unwrap().0);
    let old_root = data.join("app-updates/versions").join(&old_id);
    copy_dir(
        &data.join("app-updates/versions").join(&candidate),
        &old_root,
    );
    let interrupted = SelectionState {
        trial: Some(candidate.clone()),
        active: Some(old_id.clone()),
        extra: initial.extra.clone(),
        ..SelectionState::default()
    };
    write_selection_state_atomic(&data, &interrupted).unwrap();
    let node_recovered = node_state_action(&payload_module, &base, &data, "select", "");
    write_selection_state_atomic(&data, &interrupted).unwrap();
    let rust_recovered = select_installed_payload(&base, &data, Some(public_key), &crypto).unwrap();
    assert_eq!(rust_recovered.id.as_deref(), Some(old_id.as_str()));
    assert!(!rust_recovered.trial);
    assert_eq!(
        node_recovered,
        serde_json::json!({
            "id": rust_recovered.id,
            "trial": rust_recovered.trial,
            "state": read_selection_state(&data).unwrap(),
        })
    );
    assert_eq!(
        read_selection_state(&data).unwrap().failed.as_deref(),
        Some(candidate.as_str())
    );

    let mut failed_trial = read_selection_state(&data).unwrap();
    failed_trial.trial = Some(candidate.clone());
    failed_trial.active = Some(old_id.clone());
    write_selection_state_atomic(&data, &failed_trial).unwrap();
    let node_rollback = node_state_action(&payload_module, &base, &data, "rollback", "");
    write_selection_state_atomic(&data, &failed_trial).unwrap();
    assert!(rollback_installed_trial(&data).unwrap());
    assert_eq!(
        node_rollback,
        serde_json::to_value(read_selection_state(&data).unwrap()).unwrap()
    );
    assert_eq!(
        read_selection_state(&data).unwrap().active.as_deref(),
        Some(old_id.as_str())
    );
    assert_eq!(
        read_selection_state(&data).unwrap().failed.as_deref(),
        Some(candidate.as_str())
    );
    assert!(!rollback_installed_trial(&data).unwrap());

    let version = data.join("app-updates/versions").join(id);
    let asset = version.join("web/index.html");
    let original_asset = fs::read(&asset).unwrap();
    fs::write(&asset, b"changed but still present\n").unwrap();
    assert!(verify_persisted_version(&base, &data, id, public_key, &crypto).is_err());
    let rejected_file = node(
        &payload_module,
        &[base.to_str().unwrap(), data.to_str().unwrap(), id],
        NODE_VERIFY,
    );
    assert!(!rejected_file.status.success());
    assert!(String::from_utf8_lossy(&rejected_file.stdout).starts_with("rejected:"));
    fs::write(&asset, original_asset).unwrap();

    let envelope_path = version.join("signed-manifest.json");
    let original_envelope = fs::read(&envelope_path).unwrap();
    let mut envelope: Value = serde_json::from_slice(&original_envelope).unwrap();
    let mut signature = crypto
        .decode_base64(envelope["signature"].as_str().unwrap())
        .unwrap();
    signature[0] ^= 1;
    use base64::Engine;
    envelope["signature"] = base64::engine::general_purpose::STANDARD
        .encode(signature)
        .into();
    fs::write(&envelope_path, serde_json::to_vec(&envelope).unwrap()).unwrap();
    assert!(verify_persisted_version(&base, &data, id, public_key, &crypto).is_err());
    let rejected_signature = node(
        &payload_module,
        &[base.to_str().unwrap(), data.to_str().unwrap(), id],
        NODE_VERIFY,
    );
    assert!(!rejected_signature.status.success());
    fs::write(&envelope_path, original_envelope).unwrap();
    assert!(verify_persisted_version(&base, &data, id, public_key, &crypto).is_ok());

    let migrations = base.join("api/prisma/migrations");
    let migration = fs::read_dir(&migrations)
        .unwrap()
        .filter_map(Result::ok)
        .find(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .unwrap()
        .path();
    for name in ["Aa_extra.sql", "résumé.sql", "extra-name.sql"] {
        let extra = migration.join(name);
        fs::write(&extra, "outside the accepted Prisma filename subset\n").unwrap();
        let node_hash = node(
            &payload_module,
            &[base.to_str().unwrap()],
            NODE_DATABASE_HASH,
        );
        assert!(node_hash.status.success());
        assert_eq!(String::from_utf8_lossy(&node_hash.stdout).len(), 64);
        assert_eq!(
            base_info_from_runtime(&base, &crypto),
            Err(rust_payload::PayloadError::UnsafePath),
            "Rust must fail closed for case, Unicode, or unsupported punctuation"
        );
        fs::remove_file(extra).unwrap();
    }

    fs::remove_dir_all(scratch).unwrap();
}

#[test]
fn state_file_replacement_round_trips_repeated_updates() {
    let scratch = scratch_dir();
    let first = SelectionState {
        active: Some("v1.2.3-0123456789abcdef".into()),
        ..SelectionState::default()
    };
    let second = SelectionState {
        active: Some("v1.2.4-0123456789abcdef".into()),
        failed: Some("v1.2.2-0123456789abcdef".into()),
        ..SelectionState::default()
    };
    write_selection_state_atomic(&scratch, &first).unwrap();
    assert_eq!(read_selection_state(&scratch).unwrap(), first);
    write_selection_state_atomic(&scratch, &second).unwrap();
    assert_eq!(read_selection_state(&scratch).unwrap(), second);
    fs::remove_dir_all(scratch).unwrap();
}

#[test]
fn state_reader_and_writer_refuse_link_like_or_non_directory_descendants() {
    let scratch = scratch_dir();
    let updates = scratch.join("app-updates");
    fs::write(&updates, "occupied path").unwrap();
    assert!(read_selection_state(&scratch).is_err());
    assert!(write_selection_state_atomic(&scratch, &SelectionState::default()).is_err());
    assert_eq!(fs::read_to_string(&updates).unwrap(), "occupied path");
    fs::remove_dir_all(scratch).unwrap();

    let malformed = scratch_dir();
    let update_dir = malformed.join("app-updates");
    fs::create_dir_all(&update_dir).unwrap();
    let state_file = update_dir.join("state.json");
    fs::write(&state_file, r#"{"active":42}"#).unwrap();
    assert!(read_selection_state(&malformed).is_err());
    assert!(write_selection_state_atomic(&malformed, &SelectionState::default()).is_err());
    assert_eq!(fs::read_to_string(&state_file).unwrap(), r#"{"active":42}"#);
    fs::remove_dir_all(malformed).unwrap();
}
