param(
  [string]$TaskName = "RocStarr ScreenShare",
  [ValidateSet("CurrentUser", "System")]
  [string]$Scope = "CurrentUser",
  [int]$StartupDelaySeconds = 20
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "Start-ScreenShare.ps1"
if (-not (Test-Path $scriptPath)) {
  throw "Missing startup script: $scriptPath"
}

$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -StartupDelaySeconds $StartupDelaySeconds"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = if ($Scope -eq "System") {
  New-ScheduledTaskTrigger -AtStartup
} else {
  New-ScheduledTaskTrigger -AtLogOn
}
$principal = if ($Scope -eq "System") {
  New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
} else {
  New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
}
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Write-Host "Installed startup task: $TaskName"
Write-Host "Scope: $Scope"
Write-Host "Start it now with: Start-ScheduledTask -TaskName `"$TaskName`""
