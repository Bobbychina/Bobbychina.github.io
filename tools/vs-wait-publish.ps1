# Wait for GitHub Pages to publish the new build: poll the live atlas file
# until it carries this round's markers (PlayerSkins + deco_l1).
# Keep this file ASCII-only (Windows PowerShell 5.1 encoding quirks).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\vs-wait-publish.ps1 [maxSeconds]

param([int]$MaxSeconds = 600)

$url = 'https://bobbychina.github.io/games/vampire-survivors/js/render/sprites.js'
$start = Get-Date
Write-Output "waiting for Pages to publish:"
Write-Output "  $url"
Write-Output "criterion: file contains PlayerSkins and deco_l1"
Write-Output ""

while (((Get-Date) - $start).TotalSeconds -lt $MaxSeconds) {
  $elapsed = [int]((Get-Date) - $start).TotalSeconds
  $ts = [int][double]::Parse((Get-Date -UFormat %s))
  try {
    $r = Invoke-WebRequest "$url`?ts=$ts" -UseBasicParsing -TimeoutSec 45
    $len = $r.RawContentLength
    $hasSkins = $r.Content -match 'PlayerSkins'
    $hasDeco = $r.Content -match 'deco_l1'
    Write-Output ("[{0,4}s] {1} bytes  PlayerSkins={2}  deco_l1={3}" -f $elapsed, $len, $hasSkins, $hasDeco)
    if ($hasSkins -and $hasDeco) {
      Write-Output ""
      Write-Output "PUBLISHED: live site serves the new build"
      exit 0
    }
  } catch {
    Write-Output ("[{0,4}s] request failed: {1}" -f $elapsed, $_.Exception.Message)
  }
  Start-Sleep -Seconds 20
}

Write-Output ""
Write-Output "TIMEOUT: live site still stale after ${MaxSeconds}s (Pages may still be queued)"
exit 1
