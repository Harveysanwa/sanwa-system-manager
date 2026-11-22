# ============================================================================
#  Sanwa系统管理器 · 启动器
#  作用：若本地服务未运行则后台启动它，然后打开桌面「Sanwa系统管理器.html」。
#  用法：双击 $env:SANWA_HOME\start-sanwa.cmd，或
#       powershell -NoProfile -ExecutionPolicy Bypass -File start-hub.ps1
#  参数：-NoOpen 只启动服务不打开界面
# ============================================================================
param(
    [switch]$NoOpen,
    [int]$Port = $(if ($env:SANWA_PORT) { [int]$env:SANWA_PORT } else { 9900 })
)

$ErrorActionPreference = 'Stop'

$root       = Split-Path -Parent $PSScriptRoot
$serverJs   = Join-Path $root 'server.js'
$desktopHtml = '$env:USERPROFILE\Desktop\Sanwa系统管理器.html'
$hubUrl     = ('http://127.0.0.1:' + $Port + '/')
$logFile    = Join-Path (Join-Path $root 'logs') 'hub.log'
$pidFile    = Join-Path (Join-Path $root 'data') 'hub.pid'

function Test-HubPort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(800, $false)
        if ($ok -and $client.Connected) { return $true }
        return $false
    } catch {
        return $false
    } finally {
        try { $client.Close() } catch { }
    }
}

function Open-HubUi {
    if (Test-Path -LiteralPath $desktopHtml) {
        Start-Process -FilePath $desktopHtml | Out-Null
    } else {
        Start-Process -FilePath $hubUrl | Out-Null
    }
}

Write-Host ''
Write-Host '  Sanwa系统管理器 · 启动器' -ForegroundColor Magenta
Write-Host '  -------------------------------------------------' -ForegroundColor DarkGray

if (-not (Test-Path -LiteralPath $serverJs)) {
    Write-Host ('  [X] 未找到服务端脚本：' + $serverJs) -ForegroundColor Red
    exit 1
}

if (Test-HubPort) {
    Write-Host '  [OK] 控制服务已在运行（127.0.0.1:9900），直接打开界面。' -ForegroundColor Green
    if (-not $NoOpen) { Open-HubUi }
    exit 0
}

# 定位 Node.js
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not $node) {
    $candidates = @(
        'C:\Program Files\nodejs\node.exe',
        'C:\Program Files (x86)\nodejs\node.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { $node = $c; break }
    }
}
if (-not $node) {
    Write-Host '  [X] 未找到 Node.js（需要 Node 22 及以上）。' -ForegroundColor Red
    Write-Host '      安装位置参考：C:\Program Files\nodejs\node.exe' -ForegroundColor Yellow
    exit 1
}

$ver = & $node -v 2>$null
Write-Host ('  [>] Node.js ' + $ver + '（' + $node + '）')
Write-Host '  [>] 正在后台启动控制服务…'

$proc = $null
try {
    $proc = Start-Process -FilePath $node -ArgumentList ('"' + $serverJs + '"') `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru
} catch {
    Write-Host ('  [X] 启动失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

$deadline = (Get-Date).AddSeconds(25)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-HubPort) { $ready = $true; break }
    if ($proc -and $proc.HasExited) { break }
}

if (-not $ready) {
    Write-Host '  [X] 控制服务启动失败或超时。' -ForegroundColor Red
    if (Test-Path -LiteralPath $logFile) {
        Write-Host '  最近日志：' -ForegroundColor DarkGray
        Get-Content -LiteralPath $logFile -Tail 12 | ForEach-Object { Write-Host ('   ' + $_) -ForegroundColor DarkGray }
    }
    Write-Host ('  可手动运行排查：node "' + $serverJs + '"') -ForegroundColor Yellow
    exit 1
}

Write-Host ('  [OK] 控制服务已启动：' + $hubUrl) -ForegroundColor Green
if ($proc) { Write-Host ('  [OK] 进程 PID：' + $proc.Id) -ForegroundColor Green }
Write-Host ('  [>] 界面文件：' + $desktopHtml)
if (-not $NoOpen) {
    Write-Host '  [>] 正在打开界面…'
    Open-HubUi
}
Write-Host ''
exit 0
