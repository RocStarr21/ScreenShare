<#
.SYNOPSIS
  Shows the most recent sign-in code the app issued.

.DESCRIPTION
  With no email provider configured (RESEND_API_KEY empty), the app cannot send
  the verification email — it prints the code to the container log instead. This
  pulls the newest one out and tells you whether it is still valid.

  This is a stopgap. Once the Cloudflare Access application is in place you sign
  in through Access and never need a code. To get real emails instead, set
  RESEND_API_KEY and RESEND_FROM_DOMAIN in .env.

.EXAMPLE
  .\Get-ScreenShareLoginCode.ps1
#>
param(
  [int]$LookbackMinutes = 30
)

$ErrorActionPreference = "Continue"

# Codes expire 10 minutes after they are issued.
$validityMinutes = 10

$lines = docker logs -t cap-web --since "${LookbackMinutes}m" 2>&1 |
  Select-String -Pattern "Code:|Email:"

if (-not $lines) {
  Write-Host "No sign-in codes issued in the last $LookbackMinutes minutes." -ForegroundColor Yellow
  Write-Host "Request one at your sign-in page, then run this again."
  return
}

# Walk backwards to pair the newest "Code:" with the "Email:" printed just above it.
$entries = @()
$pendingEmail = $null
foreach ($line in $lines) {
  $text = $line.ToString()
  if ($text -match "Email:\s*(\S+)") { $pendingEmail = $Matches[1] }
  elseif ($text -match "^(\S+)\s.*Code:\s*(\d+)") {
    $entries += [pscustomobject]@{
      IssuedUtc = [datetime]::Parse($Matches[1]).ToUniversalTime()
      Code      = $Matches[2]
      Email     = $pendingEmail
    }
    $pendingEmail = $null
  }
}

$latest = $entries | Sort-Object IssuedUtc | Select-Object -Last 1
if (-not $latest) {
  Write-Host "Could not parse a code out of the log." -ForegroundColor Yellow
  return
}

$ageMinutes = ((Get-Date).ToUniversalTime() - $latest.IssuedUtc).TotalMinutes
$remaining = [math]::Round($validityMinutes - $ageMinutes, 1)

Write-Host ""
Write-Host "  Email : $($latest.Email)"
Write-Host "  Code  : $($latest.Code)" -ForegroundColor Cyan
if ($remaining -gt 0) {
  Write-Host "  Valid : about $remaining more minutes" -ForegroundColor Green
} else {
  Write-Host "  Valid : EXPIRED - request a new code, then run this again" -ForegroundColor Red
}
Write-Host ""
