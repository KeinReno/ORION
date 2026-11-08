<#! Read-only sample of explicitly selected Windows processes. #>
param(
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][int[]]$ProcessIds,
    [ValidateRange(1, 3600)][int]$Seconds = 10,
    [ValidateRange(100, 5000)][int]$IntervalMs = 500
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
$ids = @($ProcessIds | Sort-Object -Unique)
$start = [System.Diagnostics.Stopwatch]::StartNew()
$previous = @{}
$samples = [System.Collections.Generic.List[object]]::new()
while ($start.Elapsed.TotalSeconds -lt $Seconds) {
    $sampleTime = $start.Elapsed.TotalSeconds
    foreach ($processId in $ids) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            $samples.Add([pscustomobject]@{ id = $processId; elapsedSeconds = $sampleTime; available = $false })
            $previous.Remove($processId)
            continue
        }
        try {
            $identity = $process.StartTime.ToUniversalTime().ToString('o')
            $cpu = $process.TotalProcessorTime.TotalSeconds
            $percent = $null
            if ($previous.ContainsKey($processId)) {
                $last = $previous[$processId]
                if ($last.identity -eq $identity -and $sampleTime -gt $last.time) {
                    $percent = [math]::Round(100 * ($cpu - $last.cpu) / ($sampleTime - $last.time), 2)
                }
            }
            $samples.Add([pscustomobject]@{
                id = $processId; name = $process.ProcessName; startedAtUtc = $identity
                elapsedSeconds = [math]::Round($sampleTime, 3); available = $true
                workingSetBytes = $process.WorkingSet64; privateBytes = $process.PrivateMemorySize64
                cpuPercentOneCore = $percent
            })
            $previous[$processId] = @{ identity = $identity; cpu = $cpu; time = $sampleTime }
        } catch {
            $samples.Add([pscustomobject]@{ id = $processId; elapsedSeconds = $sampleTime; available = $false })
            $previous.Remove($processId)
        } finally { $process.Dispose() }
    }
    Start-Sleep -Milliseconds $IntervalMs
}
[pscustomobject]@{
    kind = 'orion-runtime-process-sample-v1'
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    intervalMs = $IntervalMs
    requestedSeconds = $Seconds
    processIds = $ids
    samples = @($samples.ToArray())
} | ConvertTo-Json -Depth 5
