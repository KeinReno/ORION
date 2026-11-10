#[path = "../src/rust_api.rs"]
mod rust_api;

use rust_api::{
    api_exit_decision, api_mode, ExitDecision, HealthEvidence, LanNodeConfig, StartupPhase,
    StartupState, TrialReadiness, TrialReadinessGate, DEFAULT_LAN_PORT, RESTART_DELAY_MS,
};

#[test]
fn missing_malformed_and_non_host_node_config_select_local_mode() {
    for config in [None, Some("{"), Some(r#"{"mode":"local","port":9000}"#)] {
        let node = LanNodeConfig::parse_or_local(config);
        let mode = api_mode(&node, false, Some("192.168.1.4"), "orion-pc", None);
        assert_eq!(mode.mode, "local");
        assert!(!mode.lan_host);
        assert_eq!(mode.host, "127.0.0.1");
        assert_eq!(mode.public_api_url, None);
    }
}

#[test]
fn host_mode_builds_launcher_compatible_overlay_and_port_fallback() {
    let node = LanNodeConfig::parse_or_local(Some(r#"{"mode":"host","port":4555}"#));
    let host = api_mode(&node, false, Some("192.168.1.9"), "orion-pc", None);
    assert_eq!(host.mode, "server");
    assert!(host.lan_host);
    assert_eq!(host.host, "127.0.0.1");
    assert_eq!(
        host.public_api_url.as_deref(),
        Some("https://192.168.1.9:4555")
    );
    assert_eq!(host.web_origins, Some("http://tauri.localhost"));

    let missing_port = LanNodeConfig::parse_or_local(Some(r#"{"mode":"host"}"#));
    let fallback = api_mode(&missing_port, false, None, "orion-pc", None);
    assert_eq!(
        fallback.public_api_url.as_deref(),
        Some("https://orion-pc:4443")
    );
    assert_eq!(missing_port.effective_port(), DEFAULT_LAN_PORT);
}

#[test]
fn forced_local_mode_surfaces_the_lan_failure_reason() {
    let node = LanNodeConfig::parse_or_local(Some(r#"{"mode":"host"}"#));
    let local = api_mode(
        &node,
        true,
        Some("192.168.1.9"),
        "orion-pc",
        Some("EADDRINUSE"),
    );
    assert_eq!(local.mode, "local");
    assert!(!local.lan_host);
    assert_eq!(local.host_failed_reason.as_deref(), Some("EADDRINUSE"));
}

#[test]
fn startup_state_matches_launcher_json_shape_and_phases() {
    for (phase, text) in [
        (StartupPhase::Preparing, "preparing"),
        (StartupPhase::Database, "database"),
        (StartupPhase::Migrations, "migrations"),
        (StartupPhase::Server, "server"),
    ] {
        let state = StartupState { phase };
        assert_eq!(state.phase.as_launcher_value(), text);
        assert_eq!(state.launcher_json(), serde_json::json!({ "phase": text }));
    }
}

#[test]
fn payload_trial_requires_matching_ui_ack_and_healthy_database() {
    let mut gate = TrialReadinessGate::new("build-abc");
    assert_eq!(gate.evaluate(), TrialReadiness::Pending); // Spawn alone is not readiness.
    gate.record_ui_ack("stale-build");
    gate.record_health(HealthEvidence {
        http_ok: true,
        database: Some("ok".into()),
    });
    assert_eq!(gate.evaluate(), TrialReadiness::Pending);
    gate.record_ui_ack("build-abc");
    assert_eq!(gate.evaluate(), TrialReadiness::CommitPayload);
}

#[test]
fn payload_trial_rejects_failed_http_or_database_and_rolls_back_on_timeout() {
    for evidence in [
        HealthEvidence {
            http_ok: false,
            database: Some("ok".into()),
        },
        HealthEvidence {
            http_ok: true,
            database: Some("error".into()),
        },
        HealthEvidence {
            http_ok: true,
            database: None,
        },
    ] {
        let mut gate = TrialReadinessGate::new("b1");
        gate.record_ui_ack("b1");
        gate.record_health(evidence);
        assert_eq!(gate.evaluate(), TrialReadiness::Pending);
    }
    let mut gate = TrialReadinessGate::new("b1");
    gate.timeout();
    assert_eq!(gate.evaluate(), TrialReadiness::RollBackPayload);
}

#[test]
fn exit_75_restarts_and_takes_precedence_over_lan_fallback() {
    assert_eq!(
        api_exit_decision(Some(75), true, false, "bind failed"),
        ExitDecision::RestartForNodeMode {
            delay_ms: RESTART_DELAY_MS
        },
    );
}

#[test]
fn first_lan_host_failure_fails_over_once_with_reason() {
    let decision = api_exit_decision(
        Some(1),
        true,
        false,
        "Error: Конфигурация небезопасна\n- EADDRINUSE: порт занят\nmore details",
    );
    assert_eq!(
        decision,
        ExitDecision::FailOverToLocal {
            delay_ms: RESTART_DELAY_MS,
            reason: "Конфигурация небезопасна - EADDRINUSE: порт занят".into(),
        }
    );
}

#[test]
fn failed_local_retry_exits_and_zero_or_signal_exit_maps_to_one() {
    assert_eq!(
        api_exit_decision(Some(1), false, false, "failure"),
        ExitDecision::Exit { exit_code: 1 },
    );
    assert_eq!(
        api_exit_decision(Some(2), true, true, "failure"),
        ExitDecision::Exit { exit_code: 2 },
    );
    assert_eq!(
        api_exit_decision(Some(0), false, false, ""),
        ExitDecision::Exit { exit_code: 1 },
    );
    assert_eq!(
        api_exit_decision(None, false, false, ""),
        ExitDecision::Exit { exit_code: 1 },
    );
}

#[test]
fn failure_reason_strips_ansi_bounds_length_and_has_fallback() {
    assert_eq!(
        rust_api::failure_reason("\u{1b}[31mError: EACCES denied\u{1b}[0m"),
        "EACCES denied",
    );
    assert_eq!(rust_api::failure_reason("\nlast line\n"), "last line");
    assert_eq!(rust_api::failure_reason(""), "неизвестная ошибка");
    assert_eq!(
        rust_api::failure_reason(&"x".repeat(500)).chars().count(),
        400
    );
    assert_eq!(
        rust_api::failure_reason("Error: DATABASE_URL=postgres://app:secret@localhost/db failed"),
        "DATABASE_URL=postgres://[redacted]@localhost/db failed",
    );
}
