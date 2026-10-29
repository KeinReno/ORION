using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Kaiden.Habitat.WindowsHost;

/// <summary>
/// A Windows-only process-tree containment host, not a security sandbox.
/// Creates the target suspended, attaches a KILL_ON_JOB_CLOSE job, then resumes.
/// The Node parent passes a static, operator-approved argv description as Base64.
/// The task text arrives ONLY via stdin. No bearer token enters this process.
/// </summary>
internal static class Program
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint INFINITE = 0xFFFFFFFF;
    private const uint STD_OUTPUT_HANDLE = unchecked((uint)-11);
    private const uint STD_ERROR_HANDLE = unchecked((uint)-12);

    private sealed class RunRequest
    {
        public string? Executable { get; set; }
        public string? Cwd { get; set; }
        public string[]? Args { get; set; }
    }

    private static int Main(string[] arguments)
    {
        if (!OperatingSystem.IsWindows()) return Fail("windows_only");
        if (arguments.Length != 1 || arguments[0].Length > 32768) return Fail("invalid_request");
        RunRequest? request;
        try
        {
            var json = Convert.FromBase64String(arguments[0]);
            if (json.Length is < 2 or > 24576) return Fail("request_too_large");
            request = JsonSerializer.Deserialize<RunRequest>(json);
        }
        catch (Exception) { return Fail("invalid_request"); }

        if (request?.Executable is not { Length: > 0 } || request.Cwd is not { Length: > 0 } ||
            request.Args == null || request.Args.Length > 30 ||
            request.Args.Any(a => a == null || a.Length > 2048 || a.IndexOf('\0') >= 0))
            return Fail("invalid_profile");

        string executable;
        string cwd;
        try
        {
            if (!Path.IsPathFullyQualified(request.Executable) || !Path.IsPathFullyQualified(request.Cwd))
                return Fail("absolute_paths_required");
            executable = Path.GetFullPath(request.Executable);
            cwd = Path.GetFullPath(request.Cwd);
            if (!File.Exists(executable) || !Directory.Exists(cwd)) return Fail("path_unavailable");
        }
        catch (Exception) { return Fail("invalid_path"); }

        var stdout = GetStdHandle(STD_OUTPUT_HANDLE);
        var stderr = GetStdHandle(STD_ERROR_HANDLE);
        if (stdout == IntPtr.Zero || stderr == IntPtr.Zero ||
            stdout == new IntPtr(-1) || stderr == new IntPtr(-1))
            return Fail("stdio_unavailable");

        IntPtr job = IntPtr.Zero, readPipe = IntPtr.Zero, writePipe = IntPtr.Zero;
        IntPtr process = IntPtr.Zero, thread = IntPtr.Zero;
        bool started = false;
        try
        {
            job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return Fail("job_create_failed");
            var settings = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            settings.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                ref settings, Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
                return Fail("job_limit_failed");

            var attributes = new SECURITY_ATTRIBUTES
            {
                nLength = (uint)Marshal.SizeOf<SECURITY_ATTRIBUTES>(),
                bInheritHandle = true
            };
            if (!CreatePipe(out readPipe, out writePipe, ref attributes, 0))
                return Fail("stdin_pipe_failed");
            // Child inherits ONLY its read end, not the writer held by this host.
            if (!SetHandleInformation(writePipe, HANDLE_FLAG_INHERIT, 0))
                return Fail("pipe_inherit_failed");

            var startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf<STARTUPINFO>();
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = readPipe;
            startup.hStdOutput = stdout;
            startup.hStdError = stderr;
            var cmd = new StringBuilder(Quote(executable));
            foreach (var arg in request.Args) cmd.Append(' ').Append(Quote(arg));

            if (!CreateProcessW(executable, cmd, IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, cwd,
                ref startup, out var info))
                return Fail("process_create_failed");

            process = info.hProcess;
            thread = info.hThread;
            // No user code has run at the moment of AssignProcessToJobObject.
            if (!AssignProcessToJobObject(job, process)) return Fail("job_assign_failed");

            // Parent retains writer; child has read end. No pipe ownership escapes to the child.
            CloseHandle(readPipe);
            readPipe = IntPtr.Zero;
            var writeHandle = writePipe;
            writePipe = IntPtr.Zero;

            // Start pumping task input. A slow child can block the pipe but the
            // Node parent enforces a deadline and can kill this host (closing job).
            Task pump = Task.Run(async () =>
            {
                using var pipe = new FileStream(new SafeFileHandle(writeHandle, ownsHandle: true), FileAccess.Write);
                try { await Console.OpenStandardInput().CopyToAsync(pipe); }
                catch (IOException) { /* CLI already exited / closed stdin */ }
            });
            if (ResumeThread(thread) == uint.MaxValue) return Fail("resume_failed");
            started = true;
            var waitResult = WaitForSingleObject(process, INFINITE);
            if (waitResult != 0) return Fail("process_wait_failed");
            // A process that exits early closes its pipe reader; bounded task
            // input from the Node caller never contains credentials.
            try { pump.Wait(TimeSpan.FromSeconds(2)); } catch (AggregateException) { }
            if (!GetExitCodeProcess(process, out uint code)) return Fail("exit_code_failed");
            return code > int.MaxValue ? 1 : (int)code;
        }
        catch (Exception) { return Fail("host_error"); }
        finally
        {
            // If suspended process was never resumed, it must not leak.
            if (!started && process != IntPtr.Zero) TerminateProcess(process, 1);
            if (thread != IntPtr.Zero) CloseHandle(thread);
            if (process != IntPtr.Zero) CloseHandle(process);
            if (readPipe != IntPtr.Zero) CloseHandle(readPipe);
            if (writePipe != IntPtr.Zero) CloseHandle(writePipe);
            // KILL_ON_JOB_CLOSE kills remaining descendants even after parent exit.
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }

    private static int Fail(string code)
    {
        Console.Error.WriteLine("habitat_windows_host:" + code);
        return 1;
    }

    /// <summary>Windows argv quoting, including trailing backslashes and embedded quotes.</summary>
    private static string Quote(string value)
    {
        var sb = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\') { backslashes++; continue; }
            if (ch == '"')
            {
                sb.Append('\\', backslashes * 2 + 1).Append('"');
                backslashes = 0;
                continue;
            }
            sb.Append('\\', backslashes).Append(ch);
            backslashes = 0;
        }
        sb.Append('\\', backslashes * 2).Append('"');
        return sb.ToString();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public uint nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public uint cb;
        public string? lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
        public uint dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public IntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public IntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(out IntPtr read, out IntPtr write,
        ref SECURITY_ATTRIBUTES attributes, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessW(string app, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags, IntPtr environment, string cwd, ref STARTUPINFO startup, out PROCESS_INFORMATION process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint code);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(uint kind);
}
