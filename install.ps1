# ============================================================================
#  Sanwa系统管理器 · 安装脚本（用户级，无需管理员）
#  用法（PowerShell 5.1）：
#    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Autostart
#    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Force
#  参数：
#    -Autostart  创建登录自启快捷方式（%APPDATA%\...\Startup\Sanwa系统管理器.lnk）
#    -Force      覆盖已有 data\tools.json
#    -Port <n>   服务端口（默认 9900，用于展开配置中的 %SANWA_PORT%；实际监听端口由环境变量 SANWA_PORT 决定）
# ============================================================================
param(
    [switch]$Autostart,
    [switch]$Force,
    [int]$Port = $(if ($env:SANWA_PORT) { [int]$env:SANWA_PORT } else { 9900 })
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dataDir = Join-Path $root 'data'
$logsDir = Join-Path $root 'logs'
$pidsDir = Join-Path $dataDir 'pids'
$exampleTools = Join-Path $dataDir 'tools.example.json'
$toolsJson = Join-Path $dataDir 'tools.json'

function Write-Step($t) { Write-Host ('  [>] ' + $t) -ForegroundColor Cyan }
function Write-Ok($t) { Write-Host ('  [OK] ' + $t) -ForegroundColor Green }
function Write-Warn3($t) { Write-Host ('  [!] ' + $t) -ForegroundColor Yellow }
function Write-Err3($t) { Write-Host ('  [X] ' + $t) -ForegroundColor Red }

Write-Host ''
Write-Host '  Sanwa系统管理器 · 安装' -ForegroundColor Magenta
Write-Host '  ------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ('  应用目录：' + $root)
Write-Host ('  服务端口：' + $Port)

# 1) Node.js 检查（>= 22）
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not $node) {
    $candidates = @(
        'C:\Program Files\nodejs\node.exe',
        'C:\Program Files (x86)\nodejs\node.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { $node = $c; break } }
}
if (-not $node) {
    Write-Err3 '未找到 Node.js。请安装 Node.js 22 或更高版本后重试。'
    Write-Warn3 '下载地址：https://nodejs.org/'
    exit 1
}
$nodeVer = (& $node -v) -replace '^v', ''
$major = 0
try { $major = [int](($nodeVer -split '\.')[0]) } catch { $major = 0 }
if ($major -lt 22) {
    Write-Err3 ('Node.js 版本过低：v' + $nodeVer + '，需要 v22 或更高。')
    Write-Warn3 '下载地址：https://nodejs.org/'
    exit 1
}
Write-Ok ('Node.js v' + $nodeVer + '（' + $node + '）')

# 2) 目录
foreach ($d in @($dataDir, $logsDir, $pidsDir)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}
Write-Ok '数据/日志目录已就绪'

# 3) 生成 data/tools.json
function Expand-Placeholders([string]$text, [string]$AppHome, [int]$Port) {
    $aiRoot = if ($env:SANWA_AI_ROOT) { $env:SANWA_AI_ROOT } else { Join-Path $env:USERPROFILE 'AI' }
    $modelsRoot = if ($env:SANWA_MODELS_ROOT) { $env:SANWA_MODELS_ROOT } else { Join-Path $aiRoot 'models' }
    $prog = $env:ProgramFiles
    $progX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $map = [ordered]@{
        '%USERPROFILE%' = $env:USERPROFILE
        '%APPDATA%' = $env:APPDATA
        '%LOCALAPPDATA%' = $env:LOCALAPPDATA
        '%PUBLIC%' = $env:PUBLIC
        '%SANWA_HOME%' = $AppHome
        '%SANWA_AI_ROOT%' = $aiRoot
        '%SANWA_MODELS_ROOT%' = $modelsRoot
        '%SANWA_PORT%' = [string]$Port
        '%PROGRAMFILES%' = $prog
        '%PROGRAMFILES(X86)%' = $progX86
        '%LMSTUDIO_HOME%' = $(if ($env:LMSTUDIO_HOME) { $env:LMSTUDIO_HOME } else { Join-Path $prog 'LM Studio' })
        '%DSH_EXE%' = $(if ($env:DSH_EXE) { $env:DSH_EXE } else { Join-Path $env:USERPROFILE 'DeepSeek Harness\DeepSeek Harness.exe' })
        '%DSH_HOME%' = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE 'DeepSeek Harness' })
        '%COMFYUI_HOME%' = $(if ($env:COMFYUI_HOME) { $env:COMFYUI_HOME } else { Join-Path $env:USERPROFILE 'ComfyUI' })
        '%PORTABLE_DRIVE%' = $(if ($env:PORTABLE_DRIVE) { $env:PORTABLE_DRIVE } else { $env:USERPROFILE })
        '%KIWIX_HOME%' = $(if ($env:KIWIX_HOME) { $env:KIWIX_HOME } else { Join-Path $env:USERPROFILE 'Kiwix' })
        '%PYTHON314_HOME%' = $(if ($env:PYTHON314_HOME) { $env:PYTHON314_HOME } else { Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314' })
        '%VENDOR_AI_ADVISOR_HOME%' = $(if ($env:VENDOR_AI_ADVISOR_HOME) { $env:VENDOR_AI_ADVISOR_HOME } else { Join-Path $prog 'OEM\AIAdvisor' })
    }
    foreach ($k in $map.Keys) {
        $val = [string]$map[$k]
        $val = $val.Replace('\', '\\').Replace('"', '\"')
        $text = $text.Replace($k, $val)
    }
    return $text
}

if ((Test-Path -LiteralPath $toolsJson) -and (-not $Force)) {
    Write-Warn3 'data\tools.json 已存在，跳过生成（-Force 可重新生成覆盖）'
} else {
    if (-not (Test-Path -LiteralPath $exampleTools)) {
        Write-Err3 ('缺少示例配置：' + $exampleTools)
        exit 1
    }
    $raw = [System.IO.File]::ReadAllText($exampleTools, [System.Text.Encoding]::UTF8)
    $expanded = Expand-Placeholders $raw $root $Port
    try {
        $cfg = $expanded | ConvertFrom-Json
        $desktopPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sanwa系统管理器.html'
        $cfg.hub.desktopHtml = $desktopPath
        $cfg.hub.root = $root
        $cfg.hub.startCmd = (Join-Path $root 'start-sanwa.cmd')
        $cfg.hub.webIndex = (Join-Path $root 'web\index.html')
        $cfg.hub.logsDir = (Join-Path $root 'logs')
        $cfg.hub.scriptsDir = (Join-Path $root 'scripts')
        $cfg.hub.pidFile = (Join-Path $root 'data\hub.pid')
        $expanded = $cfg | ConvertTo-Json -Depth 30
    } catch {
        Write-Warn3 ('tools.json 后处理失败（保留占位符展开结果）：' + $_.Exception.Message)
        $desktopPath = Join-Path $env:USERPROFILE 'Desktop\Sanwa系统管理器.html'
    }
    [System.IO.File]::WriteAllText($toolsJson, $expanded, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok '已从 data\tools.example.json 生成 data\tools.json'
    Write-Warn3 '请编辑 data\tools.json 中 exe / cwd / 安装目录为本机实际路径（示例占位符已按默认值展开）'
}

# 4) 复制 web/index.html 到桌面（可选，file:// 离线打开）
$webIndex = Join-Path $root 'web\index.html'
$desktopHtml = if ($env:SANWA_DESKTOP) { $env:SANWA_DESKTOP } else { Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sanwa系统管理器.html' }
if (Test-Path -LiteralPath $webIndex) {
    Copy-Item -LiteralPath $webIndex -Destination $desktopHtml -Force
    Write-Ok ('桌面界面已生成：' + $desktopHtml)
} else {
    Write-Warn3 'web\index.html 不存在（可运行 node scripts\build-ui.js 生成）'
}

# 5) 可选：登录自启
if ($Autostart) {
    $autoScript = Join-Path $root 'install-autostart.ps1'
    if (Test-Path -LiteralPath $autoScript) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $autoScript -Mode hidden
        if ($LASTEXITCODE -ne 0) { Write-Warn3 '登录自启安装失败，可稍后手动运行 install-autostart.ps1' }
    } else {
        Write-Warn3 '缺少 install-autostart.ps1，跳过登录自启'
    }
} else {
    Write-Step '未启用登录自启（加 -Autostart 可创建 Startup 快捷方式）'
}

Write-Host ''
Write-Ok '安装完成。'
Write-Step '启动：双击 start-sanwa.cmd，或运行 node server.js'
Write-Step '首次打开需要输入姓名 + 身份证进行生日门禁（仅本机保存、脱敏）'
Write-Host ''
