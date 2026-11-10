# Isolated benchmark Job host

This helper is separate from Habitat's host and does not change its request
protocol. It starts the packaged runtime suspended, assigns it to a private
Windows Job Object with `KILL_ON_JOB_CLOSE`, then verifies that the processes
owning both the API and PostgreSQL listening ports are members of that exact
Job Object using `IsProcessInJob(processHandle, jobHandle)`.
Listener rows are restricted to IPv4 `127.0.0.1` and `0.0.0.0` wildcard binds,
matching the benchmark's `127.0.0.1` health request. A matching port on another
interface is not accepted as proof.

Build the benchmark executable from the repository root in PowerShell:

```powershell
dotnet publish scripts/benchmark-job-host/BenchmarkJobHost.csproj `
  --configuration Release --runtime win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:PublishTrimmed=false `
  --output scripts/benchmark-job-host/bin/Release/net9.0
```

Run its isolated membership smoke before using it:

```powershell
scripts/benchmark-job-host/bin/Release/net9.0/BenchmarkJobHost.exe --smoke
```

The smoke creates two synthetic TCP listeners: one child in the helper's Job
and one child outside it. It requires exact-job membership to accept the first
and reject the second, then terminates both children it created. It does not
inspect or stop unrelated processes. It also creates a suspended synthetic
child, assigns it to a Job, terminates the Job before resume, and checks that the
child exits. When an operational non-loopback IPv4 address is available, it
also verifies that a listener in the Job on that address is rejected. Otherwise
the smoke checks known loopback, wildcard and non-loopback address values. The
normal benchmark uses this helper by default;
`packages/habitat-windows-host` is not a benchmark host because it does not
expose its private Job handle for exact membership checks.

The benchmark's reported timer starts in Node immediately before spawning this
helper. It therefore includes helper startup and the launcher's create/resume
time. The helper's ready signal is emitted only after it has received
`database=ok` and checked both listener PIDs against the exact Job handle. The
helper does not inherit the runtime's stdout handle (`CreateProcessW` uses
`inheritHandles=false`), so API stdout cannot forge the ready event.
