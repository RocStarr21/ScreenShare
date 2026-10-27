<#
.SYNOPSIS
  One-shot health and storage report for the ScreenShare stack.

.DESCRIPTION
  Answers the questions you actually need answered before trusting the app with
  client work: are all four containers healthy, is the app serving, is the
  public hostname reachable through the tunnel, how much disk are recordings
  using, and is anything stuck mid-processing.

.EXAMPLE
  .\Get-ScreenShareStatus.ps1
#>
param(
  [switch]$SkipPublicCheck
)

$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Get-EnvValue {
  param([string]$Name, [string]$Default)
  $envFile = Join-Path $repoRoot ".env"
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*?)\s*$") {
        $value = $Matches[1]
        if ($value) { return $value }
      }
    }
  }
  return $Default
}

function Write-Section { param([string]$Title) Write-Host "`n$Title" -ForegroundColor Cyan }

$capPort = Get-EnvValue -Name "CAP_PORT" -Default "3000"
$capUrl = Get-EnvValue -Name "CAP_URL" -Default "http://localhost:$capPort"
$mysqlPassword = Get-EnvValue -Name "MYSQL_PASSWORD" -Default "cap-local-pwd-123"
$minioUser = Get-EnvValue -Name "MINIO_ROOT_USER" -Default "cap-admin"
$minioPassword = Get-EnvValue -Name "MINIO_ROOT_PASSWORD" -Default "cap-minio-pwd-456"

Write-Section "Containers"
docker ps -a --filter "name=cap-" --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"

Write-Section "App"
# 127.0.0.1 rather than localhost: on this box `localhost` resolves to ::1 first
# and Invoke-WebRequest hangs on it, which reads as a false outage.
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$capPort/" -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 5
  Write-Host "  local  http://localhost:$capPort -> HTTP $($response.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "  local  http://localhost:$capPort -> NOT RESPONDING" -ForegroundColor Red
}

if (-not $SkipPublicCheck -and $capUrl -notmatch "localhost") {
  try {
    $response = Invoke-WebRequest -Uri "$capUrl/" -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 5
    Write-Host "  public $capUrl -> HTTP $($response.StatusCode)" -ForegroundColor Green
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code) {
      # 302/403 here is normal: Cloudflare Access is challenging the request.
      Write-Host "  public $capUrl -> HTTP $code" -ForegroundColor Yellow
    } else {
      Write-Host "  public $capUrl -> UNREACHABLE (tunnel down or DNS missing)" -ForegroundColor Red
    }
  }
}

Write-Section "Library"
$librarySql = "SELECT COUNT(*) AS videos, COALESCE(ROUND(SUM(duration)/60,1),0) AS total_minutes FROM videos; SELECT COUNT(*) AS accounts FROM users;"
docker exec cap-mysql mysql -ucap "-p$mysqlPassword" cap -e $librarySql 2>$null

Write-Section "Stuck processing"
$stuckSql = "SELECT video_id, phase, processing_message, started_at FROM video_uploads WHERE phase <> 'complete';"
$stuck = docker exec cap-mysql mysql -ucap "-p$mysqlPassword" cap -e $stuckSql 2>$null
if ($stuck) { $stuck } else { Write-Host "  none" -ForegroundColor Green }

Write-Section "Storage"
docker exec cap-minio mc alias set statuslocal http://127.0.0.1:9000 $minioUser $minioPassword 2>$null | Out-Null
docker exec cap-minio mc du statuslocal/cap 2>$null

Write-Host "`nDocker volume sizes:" -ForegroundColor Gray
docker system df -v --format "{{.Volumes}}" 2>$null | Out-Null
docker volume ls --filter "name=cap-" --format "  {{.Name}}"

Write-Host ""
