# ============================================================================
#  服务端拒绝 macOS（Cloudflare Pages 边缘 403）自检
#  ---------------------------------------------------------------------------
#  用法（任意目录）：
#      powershell -NoProfile -ExecutionPolicy Bypass -File tools\edge-block-check.ps1
#      powershell ... -File tools\edge-block-check.ps1 -Base https://bobbychina-games.pages.dev
#  说明：
#   - 这是**服务端**拦截的取证（对应客户端那份是 tools/mac-block-probe.mjs）：
#     直接发 HTTP 请求，看状态码与响应头，不靠任何 JS。
#   - 期望：Windows/iPad → 200；macOS（Safari UA / Chromium 平台头）→ 403 + x-blocked-platform: macos。
#   - 退出码 = 不符合预期的条数（0 = 全绿）。
#   ⚠️ 刚部署完别立刻跑：Pages 的别名切换有几秒到几十秒的传播窗口，期间可能读到旧部署。
# ============================================================================
param(
  [string]$Base = 'https://bobbychina-games.pages.dev'
)

$ErrorActionPreference = 'Continue'
$Base = $Base.TrimEnd('/')

$WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
$MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
$MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
$IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

function Probe {
  param([string]$Name, [string]$Path, [string]$UA, [string]$ExtraHeader, [int]$Want)
  $argv = @('-s', '-o', 'NUL', '-w', '%{http_code}', '-H', 'cache-control: no-cache', '-A', $UA)
  if ($ExtraHeader) { $argv += @('-H', $ExtraHeader) }
  $code = [int](& curl.exe @argv "$Base$Path")
  $flag = if ($code -eq $Want) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1,-40} {2} → {3}（期望 {4}）" -f $flag, $Name, $Path, $code, $Want) -ForegroundColor $(if ($flag -eq 'PASS') { 'Green' } else { 'Red' })
  if ($flag -eq 'PASS') { 0 } else { 1 }
}

Write-Host "服务端拦截自检：$Base" -ForegroundColor Cyan
$bad = 0
$bad += Probe 'Windows · 首页' '/' $WIN $null 200
$bad += Probe 'Windows · 游戏厅' '/games/' $WIN $null 200
$bad += Probe 'Windows · 丧尸游戏页' '/games/zombie-survival/' $WIN $null 200
$bad += Probe 'Windows · 吸血鬼页' '/games/vampire-survivors/' $WIN $null 200
$bad += Probe 'Windows · 静态脚本' '/beta-notice.js' $WIN $null 200
$bad += Probe 'Mac Safari · 首页' '/' $MAC_SAFARI $null 403
$bad += Probe 'Mac Safari · 游戏页' '/games/zombie-survival/' $MAC_SAFARI $null 403
$bad += Probe 'Mac Safari · API' '/api/score?game=vampire-survivors' $MAC_SAFARI $null 403
$bad += Probe 'Mac Chrome · 平台头' '/' $MAC_CHROME 'sec-ch-ua-platform: "macOS"' 403
$bad += Probe 'iPad 桌面模式 · 首页（不误伤）' '/' $IPAD $null 200

# 403 必须带证据头，且真的没下发页面（体积小）
$hdr = & curl.exe -s -D - -o NUL -H 'cache-control: no-cache' -A $MAC_SAFARI "$Base/"
$hasFlag = ($hdr -join "`n") -match 'x-blocked-platform:\s*macos'
$is403 = ($hdr -join "`n") -match 'HTTP/\S+\s+403'
Write-Host ("[{0}] {1,-40} {2}" -f $(if ($hasFlag -and $is403) { 'PASS' } else { 'FAIL' }), '403 带 x-blocked-platform: macos', '') -ForegroundColor $(if ($hasFlag -and $is403) { 'Green' } else { 'Red' })
if (-not ($hasFlag -and $is403)) { $bad++ }

Write-Host ''
Write-Host ("不符合预期：{0} 条" -f $bad) -ForegroundColor $(if ($bad -eq 0) { 'Green' } else { 'Red' })
exit $bad
