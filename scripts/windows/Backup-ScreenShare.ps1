<#
.SYNOPSIS
  Backs up ScreenShare recordings and the database to a location off this machine.

.DESCRIPTION
  Everything the app owns lives in two Docker volumes on this PC: the MinIO
  bucket (the actual video files, thumbnails and preview GIFs) and the MySQL
  database (titles, share links, comments, view counts, folder structure). Lose
  the machine and you lose both, so this mirrors them somewhere else.

  The bucket mirror is incremental, so re-running it only copies what changed.

.PARAMETER Destination
  Folder to back up into. Use a path on another drive, a NAS, or a synced folder
  (OneDrive/Dropbox) so the copy is genuinely off this machine.

.PARAMETER KeepDays
  Database dumps older than this are pruned. The video mirror is never pruned
  by age — use -MirrorDelete if you want it to track deletions.

.PARAMETER MirrorDelete
  Remove files from the mirror that no longer exist in the bucket. Off by
  default so that an accidental deletion in the app does not propagate to the
  only other copy.

.EXAMPLE
  .\Backup-ScreenShare.ps1 -Destination "E:\Backups\ScreenShare"
#>
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [int]$KeepDays = 30,
  [switch]$MirrorDelete
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logFile = Join-Path (Join-Path $repoRoot "logs") "screenshare-backup.log"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logFile) | Out-Null

function Write-BackupLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

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

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dbDir = Join-Path $Destination "database"
$mediaDir = Join-Path $Destination "media"
New-Item -ItemType Directory -Force -Path $dbDir, $mediaDir | Out-Null

Write-BackupLog "Backup started -> $Destination"

# ── Database ──────────────────────────────────────────────────────────────
$mysqlPassword = Get-EnvValue -Name "MYSQL_PASSWORD" -Default "cap-local-pwd-123"
$dumpPath = Join-Path $dbDir "cap-$stamp.sql"
$containerDump = "/tmp/cap-$stamp.sql"

Write-BackupLog "Dumping MySQL database..."
# Dump to a file inside the container and copy it out, rather than piping through
# PowerShell: 5.1 mangles a native command's stdout encoding and turns its stderr
# warnings into terminating errors. MYSQL_PWD keeps the password off the argv line.
# --single-transaction keeps the dump consistent without locking uploads out;
# --no-tablespaces avoids the PROCESS privilege the unprivileged `cap` user lacks.
& docker exec -e "MYSQL_PWD=$mysqlPassword" cap-mysql sh -c "mysqldump -ucap --single-transaction --quick --no-tablespaces cap > $containerDump"
if ($LASTEXITCODE -ne 0) { throw "mysqldump failed with exit code $LASTEXITCODE" }

& docker cp "cap-mysql:$containerDump" $dumpPath
if ($LASTEXITCODE -ne 0) { throw "could not copy the dump out of the container" }
& docker exec cap-mysql rm -f $containerDump | Out-Null

$dumpSize = (Get-Item $dumpPath).Length
if ($dumpSize -le 0) { throw "Database dump is empty: $dumpPath" }
Write-BackupLog ("Database dumped: {0} ({1:N1} MB)" -f (Split-Path -Leaf $dumpPath), ($dumpSize / 1MB))

# ── Recordings ────────────────────────────────────────────────────────────
$minioUser = Get-EnvValue -Name "MINIO_ROOT_USER" -Default "cap-admin"
$minioPassword = Get-EnvValue -Name "MINIO_ROOT_PASSWORD" -Default "cap-minio-pwd-456"

Write-BackupLog "Mirroring recordings out of MinIO..."
& docker exec cap-minio mc alias set backuplocal http://127.0.0.1:9000 $minioUser $minioPassword | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not authenticate against MinIO" }

# mc runs inside the container, so stage into a container path and copy out.
$stagePath = "/tmp/screenshare-backup"
& docker exec cap-minio sh -c "rm -rf $stagePath && mkdir -p $stagePath" | Out-Null
& docker exec cap-minio mc mirror --overwrite backuplocal/cap $stagePath
if ($LASTEXITCODE -ne 0) { throw "mc mirror failed with exit code $LASTEXITCODE" }

if ($MirrorDelete -and (Test-Path $mediaDir)) {
  Remove-Item -Recurse -Force -Path (Join-Path $mediaDir "*") -ErrorAction SilentlyContinue
}

& docker cp "cap-minio:$stagePath/." $mediaDir
if ($LASTEXITCODE -ne 0) { throw "docker cp of the media mirror failed" }
& docker exec cap-minio sh -c "rm -rf $stagePath" | Out-Null

$mediaBytes = (Get-ChildItem -Recurse -File -Path $mediaDir -ErrorAction SilentlyContinue |
  Measure-Object -Property Length -Sum).Sum
if (-not $mediaBytes) { $mediaBytes = 0 }
Write-BackupLog ("Recordings mirrored: {0:N1} MB" -f ($mediaBytes / 1MB))

# ── Prune old dumps ───────────────────────────────────────────────────────
$cutoff = (Get-Date).AddDays(-$KeepDays)
$pruned = Get-ChildItem -Path $dbDir -Filter "cap-*.sql" -File |
  Where-Object { $_.LastWriteTime -lt $cutoff }
foreach ($file in $pruned) {
  Remove-Item -Force $file.FullName
  Write-BackupLog "Pruned old dump: $($file.Name)"
}

Write-BackupLog "Backup complete."
