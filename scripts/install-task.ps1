# Registers a Windows Task Scheduler job that runs the FNEWS tick on a timer.
# Optional fallback for the GitHub Actions workflow.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 -IntervalMinutes 10

param(
    [int]$IntervalMinutes = 15,
    [string]$TaskName = 'FNEWS tick'
)

$ErrorActionPreference = 'Stop'

if ($IntervalMinutes -lt 5) {
    throw 'IntervalMinutes must be at least 5.'
}

$tickScript = Join-Path $PSScriptRoot 'tick.ps1'
if (-not (Test-Path $tickScript)) {
    throw "Tick script not found: $tickScript"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$tickScript`""

$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Runs one FNEWS Yahoo Finance news cycle for @FNewsChecker_bot.' `
    -Force | Out-Null

Write-Host "Task '$TaskName' registered: every $IntervalMinutes minutes."
Write-Host "Remove it with: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host 'The task runs only while this Windows user is signed in.'
