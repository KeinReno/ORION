# Native Windows Job Object host — F3e (draft)

This .NET 8 Windows executable is an optional **local process containment host** for KAIDEN Habitat. It uses the native Win32 CreateProcessW/AssignProcessToJobObject APIs. It is not an OS security sandbox, user isolation, an agent provider adapter, or a boot-time service.

## Build on a Windows machine

Prerequisites: .NET 8 SDK. Example for x64 Windows:

```powershell
dotnet publish packages/habitat-windows-host/Kaiden.Habitat.WindowsHost.csproj --configuration Release --runtime win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false --output C:\KAIDEN\habitat-windows-host
```

Use the actual produced executable path in a locally stored Habitat profile, for example:

```json
{
  "version": 1,
  "enabled": false,
  "workspaceRoot": "C:\\work\\ORION",
  "profiles": [
    {
      "id": "approved-provider",
      "executable": "C:\\trusted\\provider-cli.exe",
      "args": ["EXACT", "OPERATOR-VERIFIED", "FLAGS"],
      "windowsHost": "C:\\KAIDEN\\habitat-windows-host\\Kaiden.Habitat.WindowsHost.exe",
      "approved": false,
      "timeoutMs": 600000
    }
  ]
}
```

The operator must **manually** set `enabled=true` and `approved=true` after verifying the exact CLI and flags. None of the example paths and flags are real provider-specific recommendations. Keep this config outside Git and restrict it with NTFS ACLs.

Habitat on Windows now refuses the `run` and `run-hub` profile commands unless `windowsHost` points to a real local file. It sends the approved executable/cwd/static argv as a bounded Base64 JSON control argument to the native host; **task content is sent only over stdin**. Agent Gateway bearer tokens are never passed as arguments or environment variables to the native host or the child CLI.

## Win32 containment mechanism

1. Create a Job Object and set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
2. Prepare an inherited anonymous child-stdin pipe and stdout/stderr handles.
3. Call `CreateProcessW` with `CREATE_SUSPENDED`, so no CLI instructions execute yet.
4. Call `AssignProcessToJobObject`; **do not resume if this fails**.
5. Resume the CLI; stream the bounded task input; wait for the process to exit.
6. Close the Job Object handle. Remaining processes in its job are terminated, including on native host process termination.

The Node caller still imposes a timeout/abort. It records only output hashes, byte counts and a receipt with `verified=false`. A successful process exit can only lead to Agent Hub `review`, never `done`.

## Outstanding limitations (do not enable unattended execution)

- The host has **not been compiled or tested on Windows** in the GitHub connector environment. The source and native P/Invoke structs require a genuine Windows build and integration smoke.
- Windows Job Objects group processes but **do not restrict file, network or registry access**. Run under a dedicated, low-privilege account and restrict the worktree before permitting untrusted input.
- This host inherits the parent account's security context and environment. Native code signing and binary hash pinning are not yet implemented.
- A spawned CLI can itself have provider-specific licensing or login requirements. Detecting an executable file is not proof of authorization.
- Restrict or forbid provider implementations that deliberately break away from jobs; confirm target/provider behavior on Windows.
- The node-to-host pipe and output hashes do not provide independent artifact verification. The Job Object doesn't make model outputs trustworthy.
- There is no service installer, automatic restart, running-process attestation, or unattended task scheduler in this PR.
- The required test of terminating an actual CLI child/grandchild tree after host termination remains outstanding. See [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md).

Microsoft's Job Object docs: https://learn.microsoft.com/windows/win32/procthread/job-objects
