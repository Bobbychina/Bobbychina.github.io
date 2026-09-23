# ============================================================================
#  bobbychina.github.io 站点回归：共创游戏页 + 游戏厅 + 帧率体检
#  ---------------------------------------------------------------------------
#  用法（在本仓库根目录或任意位置）：
#     powershell -NoProfile -ExecutionPolicy Bypass -File tools\reg-site.ps1
#     powershell ... -File tools\reg-site.ps1 -Base https://bobbychina.github.io -CdpPort 9460
#  说明：
#   - 每个探针跑之前先 `_fresh_target.mjs` 刷新目标页（否则会连到上一个残留标签）
#   - 结果落盘到 E:\Files\archive\sessions\<YYYY-MM>\logs\reg-site-<时间戳>.log，同时打印摘要
#   - 退出码 = 失败项数（0 = 全过）
# ============================================================================
param(
  [string]$Base = 'https://bobbychina.github.io',
  [int]$CdpPort = 9460,
  [switch]$SkipPerf
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # tools/ 的上一层
$month = Get-Date -Format 'yyyy-MM'
$logDir = Join-Path 'E:\Files\archive\sessions' "$month\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logDir "reg-site-$stamp.log"
$shots = Join-Path 'E:\Files\myagent\_vs_shots' "reg-$stamp"
$fresh = 'E:\Files\myagent\_fresh_target.mjs'

function Run-Step {
  param([string]$Name, [string[]]$Argv)
  $out = Join-Path $env:TEMP ("reg-$([guid]::NewGuid().ToString('N')).log")
  $argLine = ($Argv | ForEach-Object { '"' + $_ + '"' }) -join ' '
  cmd /c "node $argLine > `"$out`" 2>&1"
  $code = $LASTEXITCODE
  $text = Get-Content $out -Encoding UTF8 -Raw
  Remove-Item $out -ErrorAction SilentlyContinue
  Add-Content -Path $log -Encoding utf8 -Value "`n===== $Name (exit=$code) ====="
  Add-Content -Path $log -Encoding utf8 -Value $text
  $summary = ($text -split "`r?`n" | Where-Object { $_ -match '探针：|^FPS=|FAIL' }) -join ' | '
  if (-not $summary) { $summary = ($text -split "`r?`n" | Where-Object { $_ } | Select-Object -First 1) }
  [pscustomobject]@{ Name = $Name; Exit = $code; Summary = $summary }
}

$results = @()
$vurl = "$Base/games/vampire-survivors/?v=reg$stamp"
$hurl = "$Base/games/"
$root = "$Base/?v=reg$stamp"

Write-Host "站点回归：$Base" -ForegroundColor Cyan
# ⚠️ 这些探针共用同一个 CDP 标签，**必须串行**：两支探针同时跑会互相把页面导航掉，
#    表现是 `getElementById(...) is null` 这种假红（一次真实踩坑，查了半天）。
foreach ($step in @(
    @{ n = '共创游戏页 vs-probe'; f = 'vs-probe.mjs'; u = $vurl; a = @() },
    @{ n = '尸潮之王招式 vs-boss-probe'; f = 'vs-boss-probe.mjs'; u = $vurl; a = @() },
    @{ n = '游戏厅 vs-hall-probe'; f = 'vs-hall-probe.mjs'; u = $hurl; a = @() },
    @{ n = '赛车页 racing-probe'; f = 'racing-probe.mjs'; u = "$Base/games/racing3d/"; a = @() },
    @{ n = 'macOS 拦截 mac-block-probe'; f = 'mac-block-probe.mjs'; u = $Base; a = @() }
  )) {
  cmd /c "node `"$fresh`" $CdpPort > NUL 2>&1"
  $argv = @((Join-Path $repo ('tools\' + $step.f)), $CdpPort, $step.u, $shots) + $step.a
  $results += Run-Step -Name $step.n -Argv $argv
}

if (-not $SkipPerf) {
  cmd /c "node `"$fresh`" $CdpPort > NUL 2>&1"
  $results += Run-Step -Name '帧率体检 vs-perf（空场 6s + 攒怪 60s）' -Argv @((Join-Path $repo 'tools\vs-perf.mjs'), $CdpPort, $vurl, '6', '60')
}

Write-Host ''
foreach ($r in $results) {
  $color = if ($r.Exit -eq 0) { 'Green' } else { 'Red' }
  Write-Host ("[{0}] {1}  →  {2}" -f $(if ($r.Exit -eq 0) { 'PASS' } else { 'FAIL' }), $r.Name, $r.Summary) -ForegroundColor $color
}
Add-Content -Path $log -Encoding utf8 -Value "`n===== 摘要 ====="
$results | ForEach-Object { Add-Content -Path $log -Encoding utf8 -Value ("[$($_.Exit)] $($_.Name) :: $($_.Summary)") }
Write-Host ''
Write-Host "日志：$log" -ForegroundColor DarkGray
Write-Host "截图：$shots" -ForegroundColor DarkGray
exit ($results | Where-Object { $_.Exit -ne 0 }).Count
