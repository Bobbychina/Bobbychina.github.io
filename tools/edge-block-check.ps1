# ============================================================================
#  macOS 服务端访问恢复自检
#  ---------------------------------------------------------------------------
#  用法（任意目录）：
#      powershell -NoProfile -ExecutionPolicy Bypass -File tools\edge-block-check.ps1
#      powershell ... -File tools\edge-block-check.ps1 -Base https://bobbychina-games.pages.dev
#  说明：
#   - 这是**服务端**拦截的取证（对应客户端那份是 tools/mac-block-probe.mjs）：
#     直接发 HTTP 请求，看状态码与响应头，不靠任何 JS。
#   - 期望：Windows / iPad / macOS 静态页面 → 200；无平台拦截响应头。
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
  $resultFile = Join-Path $env:TEMP ("mac-http-" + [guid]::NewGuid().ToString("N") + ".txt")
  & curl.exe @argv "$Base$Path" *> $resultFile
  $bytes = [IO.File]::ReadAllBytes($resultFile)
  $encoding = if ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 }
  $code = [int]($encoding.GetString($bytes).Trim([char]0xFEFF).Trim())
  $flag = if ($code -eq $Want) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1,-40} {2} → {3}（期望 {4}）" -f $flag, $Name, $Path, $code, $Want) -ForegroundColor $(if ($flag -eq 'PASS') { 'Green' } else { 'Red' })
  if ($flag -eq 'PASS') { 0 } else { 1 }
}

Write-Host "服务端访问自检：$Base" -ForegroundColor Cyan
$bad = 0
$bad += Probe 'Windows · 首页' '/' $WIN $null 200
$bad += Probe 'Windows · 游戏厅' '/games/' $WIN $null 200
$bad += Probe 'Windows · 丧尸游戏页' '/games/zombie-survival/' $WIN $null 200
$bad += Probe 'Windows · 吸血鬼页' '/games/vampire-survivors/' $WIN $null 200
$bad += Probe 'Windows · 静态脚本' '/beta-notice.js' $WIN $null 200
$bad += Probe 'Mac Safari · 首页' '/' $MAC_SAFARI $null 200
$bad += Probe 'Mac Safari · 游戏页' '/games/zombie-survival/' $MAC_SAFARI $null 200
$bad += Probe 'Mac Safari · 静态脚本' '/beta-notice.js' $MAC_SAFARI $null 200
$bad += Probe 'Mac Chrome · 平台头' '/' $MAC_CHROME 'sec-ch-ua-platform: "macOS"' 200
$bad += Probe 'iPad 桌面模式 · 首页（不误伤）' '/' $IPAD $null 200

$headerFile = Join-Path $env:TEMP ("mac-headers-" + [guid]::NewGuid().ToString("N") + ".txt")
& curl.exe -s -D $headerFile -o NUL -H 'cache-control: no-cache' -A $MAC_SAFARI "$Base/" *> ($headerFile + '.log')
$headers = Get-Content -LiteralPath $headerFile -Encoding UTF8 -Raw
$ok = $headers -match 'HTTP/\S+\s+200' -and $headers -notmatch 'x-blocked-platform:\s*macos'
Write-Host ("[{0}] macOS 返回 200 且无平台拦截响应头" -f $(if ($ok) { 'PASS' } else { 'FAIL' }))
if (-not $ok) { $bad++ }
Write-Host ''
Write-Host ("不符合预期：{0} 条" -f $bad) -ForegroundColor $(if ($bad -eq 0) { 'Green' } else { 'Red' })
exit $bad
