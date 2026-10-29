# KAIDEN Habitat — local approved process host (F3 alpha)

**State: local operator prototype, with an explicit loopback bridge to the draft Agent Hub F2 API; not installed as a Windows service.** Works with Node.js 20+ and has no external dependencies.

Habitat is a local human-operated process runner. It probes whether preconfigured executable paths exist **without starting them**. It can run one explicitly selected, locally approved profile only when `config.enabled`, `profile.approved`, and the command-line acknowledgement are all present. It never accepts a command, arbitrary arguments or a shell string from an LLM, MCP message or remote HTTP request.

## Local configuration (illustrative — do not commit personal paths or secrets)

```json
{
  "version": 1,
  "enabled": false,
  "workspaceRoot": "C:\\work\\ORION",
  "profiles": [
    {
      "id": "local-cli",
      "executable": "C:\\Path\\to\\trusted-cli.exe",
      "args": ["verified", "provider", "flags"],
      "approved": false,
      "timeoutMs": 600000
    }
  ]
}
```

Save this configuration locally outside the repository. Use **absolute paths** for binaries, working directories and task files. Executables and flags must be verified for each provider before approval.

```powershell
node packages/habitat/src/cli.mjs probe --config C:\private\habitat.json
node packages/habitat/src/cli.mjs run --config C:\private\habitat.json --profile local-cli --workdir C:\work\ORION --task-file C:\work\ORION\task.txt --acknowledge-local-execution
node --test packages/habitat/test/*.test.mjs
```

Execution streams the task content over stdin, with a fixed executable and fixed arguments, no shell. It restricts the working directory and task-file path using canonical filesystem paths and a maximum task size of 64 KiB. Timeout is bounded to 60 minutes. It collects only SHA-256 hashes and output byte counts, **not raw output or transcript content**. A receipt is saved under `.orion/habitat-receipts` in the chosen workspace. A receipt is **not proof of correctness**, and never auto-marks an Agent Hub task done.

## Optional loopback bridge to Agent Hub (F2)

The separate `run-hub` command binds one **human-selected queued execution** to one approved local CLI profile:

```powershell
node packages/habitat/src/cli.mjs run-hub --config C:\\private\\habitat.json --token-file C:\\private\\orion-agent-token.txt --execution-id 00000000-0000-4000-8000-000000000001 --profile local-cli --workdir C:\\work\\ORION --task-file C:\\work\\ORION\\task.txt --acknowledge-local-execution
```

- The token file contains only the ORION agent token. On POSIX its permissions must restrict group/other reads. On Windows use private NTFS ACLs.
- User must enable the Agent Hub module and provision a token authorized for `tasks:read`, `agent-hub.execution.read`, `agent-hub.execution.create`; project fences remain enforced by the server.
- Only `http://127.0.0.1`, `http://localhost` or `http://[::1]` is accepted. Remote HTTP endpoints are refused so the bearer token is not transmitted in cleartext off-device.
- The bridge checks local approval **before contacting ORION**, then claims the chosen execution, starts it, heartbeats while the local process runs, and reports `review` (exit code 0) or `failed` (nonzero exit).
- The evidence reference identifies a **local** hash-only receipt; the ORION server does not yet retrieve or verify it. It is not proof of correctness, and never sets the Task itself to done.
- F2 is a **stacked draft PR**; this bridge has been unit-tested with a mocked HTTP server, not a migrated ORION database.

## F3 observation supervisor (opt-in)

The optional `supervise` command observes the existing Agent Hub queue with a scoped read-only token, records local session/last-poll state and diagnoses unclean restarts. It does **not** claim jobs, start an agent or advertise a verified online runtime. See [SUPERVISOR.md](SUPERVISOR.md) for setup and limitations.

```powershell
node packages/habitat/src/cli.mjs supervise --config C:\\private\\habitat.json --token-file C:\\private\\orion-agent-token.txt --acknowledge-monitoring
node packages/habitat/src/cli.mjs supervisor-status --config C:\\private\\habitat.json
```

## Explicit limitations

- **Not an OS sandbox:** a spawned CLI keeps the local account's filesystem/network privileges, and a CLI can itself launch subprocesses. Do not run untrusted agents unattended with this prototype.
- On Windows the current single-process terminate/kill does not guarantee termination of a spawned process tree. A proper Windows Job Object/process-tree supervisor is required before unattended mode.
- No capability proof, provider authentication check, official Codex/Claude flags, persistent daemon, lease scheduler, ORION runtime attestation, UI or remote transport is implemented.
- `installed: true` means only that the executable file was found; it does **not** mean the provider subscription, login or API access is available.
- This package is not a trusted authorization boundary for Agent Hub. It intentionally makes no authenticated HTTP calls and requires a local operator command.
- User secrets, session tokens, CLI transcripts, project data, and personal paths must not be committed. Keep profile config local.

See `docs/adr/ADR-0039-habitat-local-runner.md` for follow-up security gates.
