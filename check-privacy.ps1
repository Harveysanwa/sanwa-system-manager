# ============================================================================
#  Sanwa系统管理器 · 发布前隐私/脱敏扫描（维护者用）
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File .\check-privacy.ps1
#  返回码 0 = PASS；1 = 发现敏感信息（禁止发布）
#  设计：
#   - 本脚本自身在排除列表，不会自我命中；
#   - 敏感字面量全部由字符串拼接构造，避免脚本本身被外部扫描误报；
#   - 用户名模式大小写敏感（大小写不敏感会误命中某些星座英文名中的片段）；
#   - vendor/许可证/资产 SVG 不参与扫描；
#   - 允许 %USERPROFILE% / %SANWA_* 等占位符。
# ============================================================================

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function J([string[]]$parts) { return ($parts -join '') }

$patterns = [ordered]@{
  'Windows 用户名路径'       = (J @('C:', '\\', 'Users', '\\', 'AS', 'US'))
  '用户目录通配（非占位符）' = (J @('C:', '\\', 'Users', '\\', '(?!', '<', '|%', ')', '[A-Za-z0-9._-]+'))
  '计算机名'                 = (J @('DESKTOP', '-RG4', 'PSQ3'))
  '旧主机名'                 = (J @('HAJ', 'EMI'))
  'Windows SID'              = (J @('S-', '1-5-', '21-', '\d+'))
  '测试身份证号'             = (J @('110105', '19491231', '002X'))
  '测试门禁姓名'             = (J @([char]0x6D4B,[char]0x8BD5,[char]0x7528,[char]0x6237))
  '本机城市拼音'             = (J @('Gui', 'yang'))
  '本机城市中文'             = (J @([char]0x8D35,[char]0x9633))
  '线上应用根'               = (J @('I:', '\\', 'AI', '\\', 'Hub'))
  '线上 AI 根'               = (J @('I:', '\\', 'AI'))
  'Steam 库'                 = (J @('K:', '\\', 'Steam', 'Library'))
  'WeGame 目录'              = (J @('E:', '\\', 'WeGame', 'Apps'))
  'Kalypso 目录'             = (J @('J:', '\\', 'Kal', 'ypso'))
  'DSH 本机目录'             = (J @('D:', '\\', [char]0x65B0,[char]0x5EFA,[char]0x6587,[char]0x4EF6,[char]0x5939))
  '真实邮箱'                 = (J @('[A-Za-z0-9._%+-]+@', '(?!users\.noreply\.github\.com)', '[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))
}
$allowList = @(
  '%USERPROFILE%', '%APPDATA%', '%LOCALAPPDATA%', '%PROGRAMFILES%', '%PROGRAMFILES(X86)%',
  '%PROGRAMDATA%', '%WINDIR%', '%SANWA_HOME%', '%SANWA_AI_ROOT%', '%SANWA_MODELS_ROOT%',
  '%SANWA_PORT%', '%DSH_EXE%', '%DSH_HOME%', '%COMFYUI_HOME%', '%LMSTUDIO_HOME%',
  '%PORTABLE_DRIVE%', '%KIWIX_HOME%', '%PYTHON314_HOME%', '%VENDOR_AI_ADVISOR_HOME%',
  'sanwa@users.noreply.github.com', 'git@github.com'
)

$excludeDirs = @('\.git\', '\lib\fortune\vendor\', '\docs\assets\')
$excludeFiles = @('check-privacy.ps1', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'COPYING')
$exts = @('.md','.txt','.js','.json','.html','.css','.ps1','.cmd','.bat','.vbs','.yml','.yaml','.svg','.example','.xml')

$files = Get-ChildItem -Recurse -File -Force | Where-Object {
  $p = $_.FullName
  if ($_.Extension -notin $exts) { return $false }
  foreach ($d in $excludeDirs) { if ($p -match [regex]::Escape($d)) { return $false } }
  foreach ($n in $excludeFiles) { if ($_.Name -ieq $n) { return $false } }
  return $true
}

$hits = @()
foreach ($f in $files) {
  $text = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
  $masked = $text
  foreach ($a in $allowList) { $masked = $masked.Replace($a, '<<ALLOWED>>') }
  # 双反斜杠归一化（源码/JSON 中常见 I:\\AI 这类转义形式，避免漏报）
  $masked = $masked -replace '\\\\', '\'
  foreach ($k in $patterns.Keys) {
    $m = [regex]::Matches($masked, $patterns[$k])
    foreach ($x in $m) {
      $line = ($masked.Substring(0, $x.Index) -split ([string][char]10)).Count
      $hits += [pscustomobject]@{ File = $f.FullName.Replace($root + '\',''); Line = $line; Kind = $k; Match = $x.Value }
    }
  }
}

if ($hits.Count -eq 0) {
  Write-Host "PASS - 0 hits. Safe to publish." -ForegroundColor Green
  exit 0
}
Write-Host ("FAIL - {0} potential sensitive hit(s):" -f $hits.Count) -ForegroundColor Red
$hits | Format-Table -AutoSize -Wrap | Out-String | Write-Host
exit 1
