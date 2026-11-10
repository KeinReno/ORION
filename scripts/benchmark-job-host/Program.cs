using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const uint CreateSuspendedFlag = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint WaitObject0 = 0;
    private const uint WaitFailed = 0xFFFFFFFF;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int AfInet = 2;
    private const int TcpTableOwnerPidListener = 3;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint ErrorInsufficientBuffer = 122;

    private sealed record LaunchRequest(string Executable, string Cwd, string[] Args, int ApiPort, int PgPort);

    private static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) return Fail("windows_only");
        if (args.Length == 1 && args[0] == "--smoke") return await SmokeAsync();
        if (args.Length == 1 && args[0].StartsWith("--synthetic-child=", StringComparison.Ordinal))
        {
            var endpoint = args[0][18..].Split(':', 2);
            if (endpoint.Length != 2 || !IPAddress.TryParse(endpoint[0], out var address)
                || address.AddressFamily != AddressFamily.InterNetwork || !int.TryParse(endpoint[1], out var port))
                return Fail("invalid_synthetic_endpoint");
            return await SyntheticChildAsync(address, port);
        }
        if (args.Length != 1) return Fail("invalid_request");

        LaunchRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<LaunchRequest>(Convert.FromBase64String(args[0]));
        }
        catch { return Fail("invalid_request"); }
        if (!ValidRequest(request)) return Fail("invalid_request");

        IntPtr job = IntPtr.Zero;
        IntPtr process = IntPtr.Zero;
        IntPtr thread = IntPtr.Zero;
        var assigned = false;
        var started = false;
        try
        {
            job = CreateConfiguredJob();
            var child = CreateSuspended(request!.Executable, request.Cwd, request.Args, out process, out thread);
            if (!AssignProcessToJobObject(job, process)) throw new InvalidOperationException("job_assign_failed");
            assigned = true;
            if (ResumeThread(thread) != 1) throw new InvalidOperationException("resume_failed");
            started = true;
            CloseHandle(thread);
            thread = IntPtr.Zero;

            await WaitForOwnedHealthAsync(job, request.ApiPort, request.PgPort, process);
            var ready = new
            {
                kind = "runtime_ready",
                apiJobOwned = true,
                postgresJobOwned = true,
                launcherPid = child.dwProcessId,
                jobProcessIds = GetJobProcessIds(job)
            };
            Console.Out.WriteLine(JsonSerializer.Serialize(ready));
            Console.Out.Flush();

            // The parent owns the benchmark lifecycle and terminates this helper
            // after post-readiness sampling. EOF is intentionally not a stop signal.
            await Task.Delay(Timeout.InfiniteTimeSpan);
            return 0;
        }
        catch (Exception error)
        {
            return Fail(error is InvalidOperationException ? error.Message : "runtime_ownership_check_failed");
        }
        finally
        {
            if (!started && assigned && job != IntPtr.Zero)
            {
                TerminateJobObject(job, 1);
                WaitForSingleObject(job, 5_000);
            }
            else if (!started && process != IntPtr.Zero)
            {
                TerminateProcess(process, 1);
                WaitForSingleObject(process, 5_000);
            }
            if (thread != IntPtr.Zero) CloseHandle(thread);
            if (process != IntPtr.Zero) CloseHandle(process);
            if (job != IntPtr.Zero) CloseHandle(job); // KILL_ON_JOB_CLOSE is the crash/abort path.
        }
    }

    private static bool ValidRequest(LaunchRequest? request) => request is not null
        && Path.IsPathFullyQualified(request.Executable)
        && Path.IsPathFullyQualified(request.Cwd)
        && File.Exists(request.Executable)
        && Directory.Exists(request.Cwd)
        && request.Args is { Length: <= 30 }
        && request.Args.All(value => value is not null && value.Length <= 2048 && !value.Contains('\0'))
        && request.ApiPort is > 0 and <= 65535
        && request.PgPort is > 0 and <= 65535
        && request.ApiPort != request.PgPort;

    private static IntPtr CreateConfiguredJob()
    {
        var job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new InvalidOperationException("job_create_failed");
        var limits = new ExtendedLimitInformation();
        limits.Basic.LimitFlags = JobObjectLimitKillOnJobClose;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits,
                Marshal.SizeOf<ExtendedLimitInformation>()))
        {
            CloseHandle(job);
            throw new InvalidOperationException("job_limit_failed");
        }
        return job;
    }

    private static ProcessInformation CreateSuspended(string executable, string cwd, string[] args,
        out IntPtr process, out IntPtr thread)
    {
        var command = new StringBuilder(Quote(executable));
        foreach (var arg in args) command.Append(' ').Append(Quote(arg));
        var startup = new StartupInfo { cb = (uint)Marshal.SizeOf<StartupInfo>() };
        var created = CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false,
            CreateSuspendedFlag | CreateNoWindow, IntPtr.Zero, cwd, ref startup, out var info);
        if (!created) throw new InvalidOperationException("process_create_failed");
        process = info.hProcess;
        thread = info.hThread;
        return info;
    }

    private static async Task WaitForOwnedHealthAsync(IntPtr job, int apiPort, int pgPort, IntPtr launcherProcess)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < TimeSpan.FromMinutes(15))
        {
            var launcherState = WaitForSingleObject(launcherProcess, 0);
            if (launcherState == WaitObject0) throw new InvalidOperationException("launcher_exited");
            if (launcherState == WaitFailed) throw new InvalidOperationException("launcher_wait_failed");
            try
            {
                using var response = await client.GetAsync($"http://127.0.0.1:{apiPort}/system/health");
                if (response.IsSuccessStatusCode)
                {
                    using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                    if (body.RootElement.TryGetProperty("database", out var database)
                        && database.GetString() == "ok")
                    {
                        if (!AnyListenerOwnedByJob(apiPort, job)) throw new InvalidOperationException("api_listener_not_in_job");
                        if (!AnyListenerOwnedByJob(pgPort, job)) throw new InvalidOperationException("postgres_listener_not_in_job");
                        return;
                    }
                }
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            await Task.Delay(250);
        }
        throw new InvalidOperationException("startup_timeout");
    }

    private static bool AnyListenerOwnedByJob(int port, IntPtr job) => ListenerPids(port).Any(pid => IsPidInJob(pid, job));

    private static bool IsPidInJob(uint pid, IntPtr job)
    {
        var process = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (process == IntPtr.Zero) return false;
        try { return IsProcessInJob(process, job, out var inJob) && inJob; }
        finally { CloseHandle(process); }
    }

    private static IReadOnlyList<uint> ListenerPids(int port, bool requireLoopbackAddress = true)
    {
        uint bytes = 0;
        var status = GetExtendedTcpTable(IntPtr.Zero, ref bytes, false, AfInet, TcpTableOwnerPidListener, 0);
        if (status != ErrorInsufficientBuffer || bytes < sizeof(uint)) return Array.Empty<uint>();
        var buffer = Marshal.AllocHGlobal((int)bytes);
        try
        {
            status = GetExtendedTcpTable(buffer, ref bytes, false, AfInet, TcpTableOwnerPidListener, 0);
            if (status != 0) return Array.Empty<uint>();
            var count = Marshal.ReadInt32(buffer);
            var result = new List<uint>();
            for (var i = 0; i < count; i++)
            {
                var row = IntPtr.Add(buffer, sizeof(uint) + i * 24);
                var localPort = (Marshal.ReadByte(row, 8) << 8) | Marshal.ReadByte(row, 9);
                var address = (Marshal.ReadByte(row, 4), Marshal.ReadByte(row, 5), Marshal.ReadByte(row, 6), Marshal.ReadByte(row, 7));
                if (localPort == port && (!requireLoopbackAddress
                    || IsAllowedLocalAddress(address.Item1, address.Item2, address.Item3, address.Item4)))
                    result.Add(unchecked((uint)Marshal.ReadInt32(row, 20)));
            }
            return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static bool IsAllowedLocalAddress(byte first, byte second, byte third, byte fourth) =>
        (first == 127 && second == 0 && third == 0 && fourth == 1)
        || (first == 0 && second == 0 && third == 0 && fourth == 0);

    private static uint[] GetJobProcessIds(IntPtr job)
    {
        // This is reporting only; ownership acceptance above uses IsProcessInJob
        // against the exact live Job handle for each port listener.
        for (var size = 4096; size <= 1_048_576; size *= 2)
        {
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!QueryInformationJobObject(job, 3, buffer, (uint)size, out _)) continue;
                const int headerBytes = 8; // two DWORDs precede ULONG_PTR ProcessIdList[]
                var count = Marshal.ReadInt32(buffer, sizeof(uint));
                var ids = new uint[Math.Min(count, (size - headerBytes) / IntPtr.Size)];
                for (var i = 0; i < ids.Length; i++)
                {
                    var raw = IntPtr.Size == 8 ? Marshal.ReadInt64(buffer, headerBytes + i * IntPtr.Size) : Marshal.ReadInt32(buffer, headerBytes + i * IntPtr.Size);
                    ids[i] = unchecked((uint)raw);
                }
                return ids;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        return Array.Empty<uint>();
    }

    private static async Task<int> SmokeAsync()
    {
        var insidePort = ReservePort();
        var outsidePort = ReservePort();
        IntPtr job = IntPtr.Zero;
        IntPtr suspendedJob = IntPtr.Zero;
        IntPtr insideProcess = IntPtr.Zero, insideThread = IntPtr.Zero;
        IntPtr suspendedProcess = IntPtr.Zero, suspendedThread = IntPtr.Zero;
        Process? outside = null;
        bool addressFilterVerified;
        try
        {
            job = CreateConfiguredJob();
            var exe = Environment.ProcessPath ?? throw new InvalidOperationException("host_path_unavailable");
            var inside = CreateSuspended(exe, Environment.CurrentDirectory,
                new[] { $"--synthetic-child={IPAddress.Loopback}:{insidePort}" }, out insideProcess, out insideThread);
            if (!AssignProcessToJobObject(job, insideProcess) || ResumeThread(insideThread) != 1)
                throw new InvalidOperationException("synthetic_job_start_failed");
            CloseHandle(insideThread);
            insideThread = IntPtr.Zero;

            outside = Process.Start(new ProcessStartInfo(exe, $"--synthetic-child={IPAddress.Loopback}:{outsidePort}")
            {
                UseShellExecute = false,
                CreateNoWindow = true
            }) ?? throw new InvalidOperationException("synthetic_outside_start_failed");
            await WaitForListenerAsync(insidePort, inside.dwProcessId);
            await WaitForListenerAsync(outsidePort, (uint)outside.Id);
            var insideVerified = AnyListenerOwnedByJob(insidePort, job);
            var outsideRejected = !AnyListenerOwnedByJob(outsidePort, job);
            var jobIds = GetJobProcessIds(job);
            var jobListVerified = jobIds.Contains(inside.dwProcessId) && !jobIds.Contains((uint)outside.Id);
            if (!insideVerified || !outsideRejected || !jobListVerified) throw new InvalidOperationException("synthetic_membership_assertion_failed");
            addressFilterVerified = IsAllowedLocalAddress(127, 0, 0, 1)
                && IsAllowedLocalAddress(0, 0, 0, 0)
                && !IsAllowedLocalAddress(192, 168, 1, 20);
            if (!addressFilterVerified) throw new InvalidOperationException("synthetic_address_filter_assertion_failed");

            var nonLoopback = FindOperationalNonLoopbackAddress();
            var nonLoopbackRejected = false;
            if (nonLoopback is not null)
            {
                var addressJob = CreateConfiguredJob();
                IntPtr addressProcess = IntPtr.Zero, addressThread = IntPtr.Zero;
                try
                {
                    var addressPort = ReservePort(nonLoopback);
                    var addressChild = CreateSuspended(exe, Environment.CurrentDirectory,
                        new[] { $"--synthetic-child={nonLoopback}:{addressPort}" }, out addressProcess, out addressThread);
                    if (!AssignProcessToJobObject(addressJob, addressProcess) || ResumeThread(addressThread) != 1)
                        throw new InvalidOperationException("synthetic_nonloopback_start_failed");
                    CloseHandle(addressThread);
                    addressThread = IntPtr.Zero;
                    await WaitForListenerAsync(addressPort, addressChild.dwProcessId);
                    var addressPidInJob = IsPidInJob(addressChild.dwProcessId, addressJob);
                    nonLoopbackRejected = addressPidInJob && !AnyListenerOwnedByJob(addressPort, addressJob);
                    if (!nonLoopbackRejected) throw new InvalidOperationException("synthetic_nonloopback_listener_accepted");
                }
                finally
                {
                    TerminateJobObject(addressJob, 6);
                    WaitForSingleObject(addressJob, 5_000);
                    if (addressThread != IntPtr.Zero) CloseHandle(addressThread);
                    if (addressProcess != IntPtr.Zero) CloseHandle(addressProcess);
                    CloseHandle(addressJob);
                }
            }

            suspendedJob = CreateConfiguredJob();
            var neverResumed = CreateSuspended(exe, Environment.CurrentDirectory,
                new[] { $"--synthetic-child={IPAddress.Loopback}:{ReservePort()}" }, out suspendedProcess, out suspendedThread);
            if (!AssignProcessToJobObject(suspendedJob, suspendedProcess))
                throw new InvalidOperationException("synthetic_pre_resume_assign_failed");
            if (!TerminateJobObject(suspendedJob, 4)
                || WaitForSingleObject(suspendedProcess, 5_000) != WaitObject0
                || WaitForSingleObject(suspendedJob, 5_000) != WaitObject0)
                throw new InvalidOperationException("synthetic_pre_resume_cleanup_failed");

            if (!TerminateJobObject(job, 2) || WaitForSingleObject(job, 10_000) != 0)
                throw new InvalidOperationException("synthetic_job_cleanup_failed");
            if (outside is { HasExited: false }) outside.Kill(entireProcessTree: true);
            if (outside is not null) await outside.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                kind = "job_membership_smoke",
                exactJobMemberAccepted = insideVerified,
                foreignProcessRejected = outsideRejected,
                jobProcessListVerified = jobListVerified,
                addressFilterVerified,
                nonLoopbackListenerRejected = nonLoopback is null || nonLoopbackRejected,
                assignedButUnresumedProcessTerminated = WaitForSingleObject(suspendedProcess, 0) == WaitObject0,
                jobChildrenTerminated = true,
                foreignChildTerminatedExplicitly = true
            }));
            return 0;
        }
        catch (Exception error) { return Fail(error is InvalidOperationException ? error.Message : "smoke_failed"); }
        finally
        {
            if (suspendedJob != IntPtr.Zero) { TerminateJobObject(suspendedJob, 5); CloseHandle(suspendedJob); }
            if (suspendedThread != IntPtr.Zero) CloseHandle(suspendedThread);
            if (suspendedProcess != IntPtr.Zero) CloseHandle(suspendedProcess);
            if (job != IntPtr.Zero) { TerminateJobObject(job, 3); CloseHandle(job); }
            if (insideThread != IntPtr.Zero) CloseHandle(insideThread);
            if (insideProcess != IntPtr.Zero) CloseHandle(insideProcess);
            if (outside is { HasExited: false }) { outside.Kill(entireProcessTree: true); await outside.WaitForExitAsync(); }
            outside?.Dispose();
        }
    }

    private static int ReservePort(IPAddress? address = null)
    {
        var listener = new TcpListener(address ?? IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static async Task WaitForListenerAsync(int port, uint pid)
    {
        var watch = Stopwatch.StartNew();
        while (watch.Elapsed < TimeSpan.FromSeconds(10))
        {
            if (ListenerPids(port, requireLoopbackAddress: false).Contains(pid)) return;
            await Task.Delay(50);
        }
        throw new InvalidOperationException("synthetic_listener_timeout");
    }

    private static async Task<int> SyntheticChildAsync(IPAddress address, int port)
    {
        using var listener = new TcpListener(address, port);
        listener.Start();
        await Task.Delay(Timeout.InfiniteTimeSpan);
        return 0;
    }

    private static IPAddress? FindOperationalNonLoopbackAddress() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(network => network.OperationalStatus == OperationalStatus.Up)
        .SelectMany(network => network.GetIPProperties().UnicastAddresses)
        .Select(entry => entry.Address)
        .FirstOrDefault(address => address.AddressFamily == AddressFamily.InterNetwork
            && !IPAddress.IsLoopback(address) && !address.Equals(IPAddress.Any));

    private static int Fail(string code)
    {
        Console.Error.WriteLine("benchmark_job_host:" + code);
        return 1;
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    [StructLayout(LayoutKind.Sequential)] private struct JobBasicLimitInformation { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimitInformation { public JobBasicLimitInformation Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo { public uint cb; public string? lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimitInformation info, int length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string app, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInformation process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("iphlpapi.dll", SetLastError = true)] private static extern uint GetExtendedTcpTable(IntPtr table, ref uint size, [MarshalAs(UnmanagedType.Bool)] bool order, int family, int tableClass, uint reserved);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, out uint returnLength);
}
