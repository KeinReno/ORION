//! Testable model of the API supervision behavior in `apps/desktop/runtime/launcher.cjs`.
//!
//! This module deliberately models decisions and readiness evidence only. It does not
//! spawn the API, read files, probe HTTP, or select the product startup path.

use serde::{Deserialize, Serialize};

pub const MODE_RESTART_EXIT_CODE: i32 = 75;
pub const RESTART_DELAY_MS: u64 = 500;
pub const DEFAULT_LAN_PORT: i64 = 4443;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanNodeConfig {
    #[serde(default)]
    pub mode: String,
    pub port: Option<i64>,
}

impl LanNodeConfig {
    /// Mirrors launcher behavior: a missing or malformed `lan-node.json` means local mode.
    pub fn parse_or_local(contents: Option<&str>) -> Self {
        contents
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or_default()
    }

    pub fn is_host(&self) -> bool {
        self.mode == "host"
    }

    /// The launcher accepts an integer port and otherwise uses 4443.
    pub fn effective_port(&self) -> i64 {
        self.port.unwrap_or(DEFAULT_LAN_PORT)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiMode {
    pub mode: &'static str,
    pub lan_host: bool,
    pub host: &'static str,
    pub public_api_url: Option<String>,
    pub web_origins: Option<&'static str>,
    pub host_failed_reason: Option<String>,
}

/// Creates the mode overlay used for one API launch. `lan_address` is supplied by
/// the caller after applying the launcher's network-interface selection rules.
pub fn api_mode(
    node: &LanNodeConfig,
    force_local: bool,
    lan_address: Option<&str>,
    hostname: &str,
    host_failed_reason: Option<&str>,
) -> ApiMode {
    if !force_local && node.is_host() {
        let address = lan_address.unwrap_or(hostname);
        ApiMode {
            mode: "server",
            lan_host: true,
            host: "127.0.0.1",
            public_api_url: Some(format!("https://{address}:{}", node.effective_port())),
            web_origins: Some("http://tauri.localhost"),
            host_failed_reason: None,
        }
    } else {
        ApiMode {
            mode: "local",
            lan_host: false,
            host: "127.0.0.1",
            public_api_url: None,
            web_origins: None,
            host_failed_reason: host_failed_reason.map(str::to_owned),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StartupPhase {
    Preparing,
    Database,
    Migrations,
    Server,
}

impl StartupPhase {
    pub fn as_launcher_value(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::Database => "database",
            Self::Migrations => "migrations",
            Self::Server => "server",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StartupState {
    pub phase: StartupPhase,
}

impl StartupState {
    pub fn launcher_json(self) -> serde_json::Value {
        serde_json::json!({ "phase": self.phase.as_launcher_value() })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HealthEvidence {
    pub http_ok: bool,
    pub database: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrialReadiness {
    Pending,
    CommitPayload,
    RollBackPayload,
}

/// Payload trial readiness requires both a matching UI ACK and `/system/health`
/// returning HTTP success with `database == "ok"`. A regular spawn is never ready evidence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrialReadinessGate {
    expected_build_tag: String,
    ui_ack: Option<String>,
    health: Option<HealthEvidence>,
    timed_out: bool,
}

impl TrialReadinessGate {
    pub fn new(expected_build_tag: impl Into<String>) -> Self {
        Self {
            expected_build_tag: expected_build_tag.into(),
            ui_ack: None,
            health: None,
            timed_out: false,
        }
    }

    pub fn record_ui_ack(&mut self, build_tag: impl Into<String>) {
        self.ui_ack = Some(build_tag.into());
    }

    pub fn record_health(&mut self, health: HealthEvidence) {
        self.health = Some(health);
    }

    pub fn timeout(&mut self) {
        self.timed_out = true;
    }

    pub fn evaluate(&self) -> TrialReadiness {
        if self.timed_out {
            return TrialReadiness::RollBackPayload;
        }
        let matching_ack = self.ui_ack.as_deref() == Some(self.expected_build_tag.as_str());
        let healthy_api = self
            .health
            .as_ref()
            .is_some_and(|h| h.http_ok && h.database.as_deref() == Some("ok"));
        if matching_ack && healthy_api {
            TrialReadiness::CommitPayload
        } else {
            TrialReadiness::Pending
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExitDecision {
    /// Restart after 500 ms and reread `lan-node.json` for the next launch.
    RestartForNodeMode { delay_ms: u64 },
    /// A failed first LAN host start gets one local attempt and surfaces its reason.
    FailOverToLocal { delay_ms: u64, reason: String },
    /// Launcher uses `process.exitCode = code || 1` for terminal exits.
    Exit { exit_code: i32 },
}

pub fn api_exit_decision(
    exit_code: Option<i32>,
    launched_as_lan_host: bool,
    already_failed_over: bool,
    captured_output: &str,
) -> ExitDecision {
    if exit_code == Some(MODE_RESTART_EXIT_CODE) {
        return ExitDecision::RestartForNodeMode {
            delay_ms: RESTART_DELAY_MS,
        };
    }
    if launched_as_lan_host && !already_failed_over {
        return ExitDecision::FailOverToLocal {
            delay_ms: RESTART_DELAY_MS,
            reason: failure_reason(captured_output),
        };
    }
    ExitDecision::Exit {
        exit_code: exit_code.filter(|code| *code != 0).unwrap_or(1),
    }
}

/// Mirrors launcher `failureReason`: prefer an Error line, retain following `- `
/// details, strip ANSI color codes, and bound the displayed reason to 400 chars.
pub fn failure_reason(output: &str) -> String {
    let lines: Vec<String> = output
        .lines()
        .map(strip_ansi)
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
        .collect();
    let at = lines
        .iter()
        .position(|line| line.starts_with("Error: "))
        .or_else(|| {
            lines.iter().position(|line| {
                ["небезопасна", "не удалось", "EADDRINUSE", "EACCES"]
                    .iter()
                    .any(|needle| line.to_lowercase().contains(&needle.to_lowercase()))
            })
        });
    let Some(at) = at else {
        let fallback = lines
            .last()
            .cloned()
            .unwrap_or_else(|| "неизвестная ошибка".to_owned());
        return redact_sensitive(&fallback).chars().take(400).collect();
    };
    let mut reason = lines[at]
        .strip_prefix("Error: ")
        .unwrap_or(&lines[at])
        .to_owned();
    for detail in lines
        .iter()
        .skip(at + 1)
        .take_while(|line| line.starts_with("- "))
    {
        reason.push(' ');
        reason.push_str(detail);
    }
    redact_sensitive(&reason).chars().take(400).collect()
}

fn redact_sensitive(value: &str) -> String {
    let mut redacted = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let lower: Vec<u8> = bytes.iter().map(u8::to_ascii_lowercase).collect();
    let markers: [&[u8]; 10] = [
        b"password=",
        b"password:",
        b"passwd=",
        b"secret=",
        b"secret:",
        b"token=",
        b"token:",
        b"authorization:",
        b"api_key=",
        b"sync_secret=",
    ];
    let mut cursor = 0;
    while cursor < bytes.len() {
        let next = markers
            .iter()
            .filter_map(|marker| {
                lower[cursor..]
                    .windows(marker.len())
                    .position(|window| window == *marker)
                    .map(|offset| (cursor + offset, *marker))
            })
            .min_by_key(|(at, _)| *at);
        let Some((at, marker)) = next else {
            redacted.push_str(&value[cursor..]);
            break;
        };
        redacted.push_str(&value[cursor..at + marker.len()]);
        let mut end = at + marker.len();
        while end < bytes.len() && bytes[end].is_ascii_whitespace() {
            redacted.push(bytes[end] as char);
            end += 1;
        }
        redacted.push_str("[redacted]");
        while end < bytes.len() && !bytes[end].is_ascii_whitespace() && !b",;".contains(&bytes[end])
        {
            end += 1;
        }
        cursor = end;
    }
    redact_url_credentials(&redacted)
}

fn redact_url_credentials(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(scheme_end) = rest.find("://") {
        result.push_str(&rest[..scheme_end + 3]);
        let authority = &rest[scheme_end + 3..];
        let authority_end = authority
            .find(['/', ' ', '\t', '\r', '\n'])
            .unwrap_or(authority.len());
        let authority_text = &authority[..authority_end];
        if let Some(at) = authority_text.rfind('@') {
            result.push_str("[redacted]@");
            result.push_str(&authority_text[at + 1..]);
        } else {
            result.push_str(authority_text);
        }
        rest = &authority[authority_end..];
    }
    result.push_str(rest);
    result
}

fn strip_ansi(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut result = String::with_capacity(value.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x1b && bytes.get(index + 1) == Some(&b'[') {
            index += 2;
            while index < bytes.len() && !(0x40..=0x7e).contains(&bytes[index]) {
                index += 1;
            }
            if index < bytes.len() {
                index += 1;
            }
        } else {
            let ch = value[index..].chars().next().expect("valid UTF-8 boundary");
            result.push(ch);
            index += ch.len_utf8();
        }
    }
    result
}
