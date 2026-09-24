# Retry git push: this machine's route to github.com is intermittent
# (git ls-remote succeeds, then fetch/push times out after 21s; no proxy).
# Keep this file ASCII-only: Windows PowerShell 5.1 mis-parses non-ASCII
# script text depending on BOM / console codepage.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\vs-push.ps1 [branch] [maxTries]

param(
  [string]$Branch = "main",
  [int]$MaxTries = 12
)

$Repo = Split-Path -Parent $PSScriptRoot
$env:GIT_TERMINAL_PROMPT = '0'

# Relax http timeouts so a slow-but-working link is not judged dead at 21s.
$gitArgs = @(
  '-c', 'http.lowSpeedLimit=1000',
  '-c', 'http.lowSpeedTime=120',
  '-c', 'http.postBuffer=524288000'
)

Write-Output "repo:   $Repo"
Write-Output "branch: $Branch"

$pending = & git -C $Repo log --oneline "origin/$Branch..HEAD" 2>&1
Write-Output "pending commits:"
if ($pending) { $pending | ForEach-Object { Write-Output "  $_" } } else { Write-Output "  (none)" }
Write-Output ""

for ($i = 1; $i -le $MaxTries; $i++) {
  Write-Output "--- attempt $i/$MaxTries ---"
  $out = (& git -C $Repo @gitArgs push origin $Branch 2>&1 | Out-String).Trim()
  if ($out) { Write-Output $out }

  if ($LASTEXITCODE -eq 0 -or $out -match 'up-to-date') {
    Write-Output ""
    Write-Output "PUSH OK"
    exit 0
  }

  $wait = [Math]::Min(30, 3 * $i)
  Write-Output "failed, retrying in ${wait}s"
  Start-Sleep -Seconds $wait
}

Write-Output ""
Write-Output "PUSH FAILED after $MaxTries attempts (github.com unreachable)"
Write-Output "Commits stay local; re-run this same command when the network recovers."
exit 1
