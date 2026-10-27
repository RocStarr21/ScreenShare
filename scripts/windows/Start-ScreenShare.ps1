<#
.SYNOPSIS
  Brings the ScreenShare stack up at logon and waits until it is actually serving.

.DESCRIPTION
  The original version ran `docker compose up -d` immediately after a fixed
  delay. At logon Docker Desktop's engine is usually still starting, so the
  command failed outright (see logs/screenshare-service.log, 2026-06-26) and the
  stack simply never came up. This version waits for the engine, retries, and
  then verifies the app answers before reporting success.
#>
param(
  [int]$StartupDelaySeconds = 20,
  [int]$DockerReadyTimeoutSeconds = 300,
  [int]$AppReadyTimeoutSeconds = 240,
  [int]$MaxAttempts = 3
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $repoRoot "logs"
$logFile = Join-Path $logDir "screenshare-service.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-ServiceLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logFile -Value "[$timestamp] $Message"
}

function Get-CapPort {
  $envFile = Join-Path $repoRoot ".env"
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*CAP_PORT\s*=\s*(\d+)\s*$') { return [int]$Matches[1] }
    }
  }
  return 3000
}

function Wait-ForDockerEngine {
  param([int]$TimeoutSeconds)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { return $true }
    } catch {
      # Engine not reachable yet; keep waiting.
    }
    Start-Sleep -Seconds 5
  }
  return $false
}

function Wait-ForApp {
  param([int]$Port, [int]$TimeoutSeconds)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing `
        -TimeoutSec 10 -MaximumRedirection 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $true }
    } catch {
      # Still starting (migrations run on first boot and take a while).
    }
    Start-Sleep -Seconds 5
  }
  return $false
}

try {
  if ($StartupDelaySeconds -gt 0) { Start-Sleep -Seconds $StartupDelaySeconds }

  $docker = Get-Command docker -ErrorAction Stop
  Write-ServiceLog "Starting ScreenShare stack from $repoRoot"

  if (-not (Wait-ForDockerEngine -TimeoutSeconds $DockerReadyTimeoutSeconds)) {
    throw "Docker engine did not become ready within $DockerReadyTimeoutSeconds seconds"
  }
  Write-ServiceLog "Docker engine is ready."

  Push-Location $repoRoot
  try {
    $started = $false
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
      & $docker.Source compose up -d 2>&1 | ForEach-Object { Write-ServiceLog "compose: $_" }
      if ($LASTEXITCODE -eq 0) { $started = $true; break }

      Write-ServiceLog "Attempt $attempt of $MaxAttempts failed with exit code $LASTEXITCODE."
      if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds (10 * $attempt) }
    }

    if (-not $started) { throw "docker compose up -d failed after $MaxAttempts attempts" }
  }
  finally {
    Pop-Location -ErrorAction SilentlyContinue
  }

  $port = Get-CapPort
  if (Wait-ForApp -Port $port -TimeoutSeconds $AppReadyTimeoutSeconds) {
    Write-ServiceLog "ScreenShare is serving on http://localhost:$port."
  } else {
    Write-ServiceLog "WARNING: containers started but http://localhost:$port did not answer within $AppReadyTimeoutSeconds seconds."
  }
}
catch {
  Write-ServiceLog "ERROR: $($_.Exception.Message)"
  throw
}
