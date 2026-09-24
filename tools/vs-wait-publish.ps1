# Wait for GitHub Pages to publish the new build: poll the live atlas file
# until it carries the markers of the NEWEST build.
# NOTE: never key the criterion on something an older build already had --
# PlayerSkins/deco_l1 existed since the 2026-09-25 09:xx build, so keying on
# them reported "published" while the site was still serving the old bytes.
# Key on the newest markers: the level-2 exclusive monsters (acidhusk).
# Keep this file ASCII-only (Windows PowerShell 5.1 encoding quirks).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\vs-wait-publish.ps1 [maxSeconds] [marker] [expectBytes]

param(
  [int]$MaxSeconds = 600,
  [string]$Marker = 'acidhusk',
  [int]$ExpectBytes = 0
)

$url = 'https://bobbychina.github.io/games/vampire-survivors/js/render/sprites.js'
$start = Get-Date
Write-Output "waiting for Pages to publish:"
Write-Output "  $url"
Write-Output "criterion: contains '$Marker'"
if ($ExpectBytes -gt 0) { Write-Output "           and byte size == $ExpectBytes" }
Write-Output ""

while (((Get-Date) - $start).TotalSeconds -lt $MaxSeconds) {
  $elapsed = [int]((Get-Date) - $start).TotalSeconds
  $ts = [int][double]::Parse((Get-Date -UFormat %s))
  try {
    $r = Invoke-WebRequest "$url`?ts=$ts" -UseBasicParsing -TimeoutSec 45
    $len = $r.RawContentLength
    $hasMarker = $r.Content -match [regex]::Escape($Marker)
    $sizeOk = ($ExpectBytes -le 0) -or ($len -eq $ExpectBytes)
    Write-Output ("[{0,4}s] {1} bytes  marker={2}  sizeOk={3}" -f $elapsed, $len, $hasMarker, $sizeOk)
    if ($hasMarker -and $sizeOk) {
      Write-Output ""
      Write-Output "PUBLISHED: live site serves the newest build"
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
